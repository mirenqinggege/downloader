import {EventEmitter} from 'events';
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import {URL} from 'url';

export interface ChunkProgress {
	index: number;
	start: number;
	end: number;
	downloaded: number;
	total: number;
	status: 'pending' | 'downloading' | 'done' | 'error';
	error?: string;
}

export interface DownloadProgress {
	totalSize: number;
	downloaded: number;
	speed: number;
	chunks: ChunkProgress[];
	status: 'connecting' | 'downloading' | 'merging' | 'done' | 'error';
	error?: string;
	filename: string;
}

interface FileInfo {
	url: string;
	size: number;
	filename: string;
	acceptRanges: boolean;
}

function getProtocol(url: string): typeof http | typeof https {
	return url.startsWith('https') ? https : http;
}

export class MultiThreadDownloader extends EventEmitter {
	private url: string;
	private threads: number;
	private output: string;
	private chunks: ChunkProgress[] = [];
	private totalSize = 0;
	private filename = '';
	private status: DownloadProgress['status'] = 'connecting';
	private error?: string;
	private aborted = false;
	private startTime = 0;
	private acceptRanges = true;

	constructor(url: string, threads: number, output?: string) {
		super();
		this.url = url;
		this.threads = threads;
		this.output = output ?? '';
	}

	private request(
		url: string,
		options: http.RequestOptions,
	): Promise<http.IncomingMessage> {
		return new Promise((resolve, reject) => {
			const mod = getProtocol(url);
			const req = mod.request(url, options, res => {
				if (
					res.statusCode &&
					res.statusCode >= 300 &&
					res.statusCode < 400 &&
					res.headers['location']
				) {
					const redirectUrl = new URL(
						res.headers['location'],
						url,
					).toString();
					res.resume();
					this.request(redirectUrl, options).then(resolve, reject);
					return;
				}

				resolve(res);
			});
			req.on('error', reject);
			req.end();
		});
	}

	private async fetchFileInfo(): Promise<FileInfo> {
		const res = await this.request(this.url, {method: 'HEAD'});

		if (!res.statusCode || res.statusCode >= 400) {
			throw new Error(
				`Server returned status ${res.statusCode ?? 'unknown'}`,
			);
		}

		const size = Number.parseInt(
			res.headers['content-length'] ?? '0',
			10,
		);
		const acceptRanges =
			res.headers['accept-ranges'] !== undefined &&
			res.headers['accept-ranges'] !== 'none';

		// Try to extract filename from Content-Disposition or URL
		let filename = '';
		const disposition = res.headers['content-disposition'];
		if (disposition) {
			const match = /filename\*?=(?:UTF-8''|"?)([^";]+)/i.exec(
				disposition,
			);
			if (match?.[1]) {
				filename = decodeURIComponent(match[1].replace(/"/g, ''));
			}
		}

		if (!filename) {
			const urlPath = new URL(this.url).pathname;
			filename = path.basename(urlPath) || 'download';
		}

		return {
			url: this.url,
			size,
			filename,
			acceptRanges,
		};
	}

	private downloadChunk(
		url: string,
		start: number,
		end: number,
		index: number,
	): Promise<string> {
		return new Promise((resolve, reject) => {
			const tempPath = `${this.output}.part${index}`;
			const writeStream = fs.createWriteStream(tempPath);
			const mod = getProtocol(url);

			const headers: Record<string, string> = {};
			if (this.acceptRanges) {
				headers['Range'] = `bytes=${start}-${end}`;
			}

			const req = mod.request(url, {headers}, res => {
				if (
					res.statusCode &&
					res.statusCode >= 300 &&
					res.statusCode < 400 &&
					res.headers['location']
				) {
					res.resume();
					writeStream.close();
					const redirectUrl = new URL(
						res.headers['location'],
						url,
					).toString();
					this.downloadChunk(redirectUrl, start, end, index).then(
						resolve,
						reject,
					);
					return;
				}

				if (!res.statusCode || res.statusCode >= 400) {
					writeStream.close();
					reject(
						new Error(
							`Chunk ${index}: HTTP ${res.statusCode ?? 'unknown'}`,
						),
					);
					return;
				}

				res.on('data', (chunk: Buffer) => {
					this.chunks[index]!.downloaded += chunk.length;
				});

				res.pipe(writeStream);

				writeStream.on('finish', () => {
					writeStream.close();
					const chunk = this.chunks[index];
					if (chunk) {
						chunk.status = 'done';
						chunk.downloaded = chunk.total;
					}

					resolve(tempPath);
				});

				writeStream.on('error', err => {
					writeStream.close();
					const chunk = this.chunks[index];
					if (chunk) {
						chunk.status = 'error';
						chunk.error = err.message;
					}

					reject(err);
				});
			});

			req.on('error', err => {
				writeStream.close();
				const chunk = this.chunks[index];
				if (chunk) {
					chunk.status = 'error';
					chunk.error = err.message;
				}

				reject(err);
			});

			req.on('abort', () => {
				writeStream.close();
			});

			req.end();
		});
	}

	private async mergeChunks(chunkPaths: string[]): Promise<void> {
		const writeStream = fs.createWriteStream(this.output);

		for (const chunkPath of chunkPaths) {
			await new Promise<void>((resolve, reject) => {
				const readStream = fs.createReadStream(chunkPath);
				readStream.pipe(writeStream, {end: false});
				readStream.on('end', () => {
					fs.unlink(chunkPath, () => {
						// Ignore cleanup errors
					});
					resolve();
				});
				readStream.on('error', reject);
			});
		}

		writeStream.end();
		await new Promise<void>((resolve, reject) => {
			writeStream.on('finish', () => resolve());
			writeStream.on('error', reject);
		});
	}

	abort(): void {
		this.aborted = true;
	}

	async start(): Promise<void> {
		try {
			this.status = 'connecting';
			this.emitProgress();

			// 1. Fetch file info
			const fileInfo = await this.fetchFileInfo();
			this.totalSize = fileInfo.size;
			this.filename = fileInfo.filename;
			this.acceptRanges = fileInfo.acceptRanges;

			if (!this.output) {
				this.output = path.resolve(process.cwd(), this.filename);
			}

			// 2. Setup chunks
			const threadCount =
				this.totalSize > 0 && this.acceptRanges
					? this.threads
					: 1;
			const chunkSize =
				this.totalSize > 0
					? Math.ceil(this.totalSize / threadCount)
					: 0;

			this.chunks = [];
			for (let i = 0; i < threadCount; i++) {
				const start = i * chunkSize;
				const end =
					i === threadCount - 1
						? this.totalSize - 1
						: (i + 1) * chunkSize - 1;

				this.chunks.push({
					index: i,
					start,
					end: Math.max(start, end),
					downloaded: 0,
					total: Math.max(start, end) - start + 1,
					status: 'pending',
				});
			}

			// 3. Download chunks concurrently
			this.status = 'downloading';
			this.startTime = Date.now();
			this.emitProgress();

			const downloadPromises = this.chunks.map(
				async (chunk, index) => {
					chunk.status = 'downloading';
					try {
						if (this.aborted) {
							throw new Error('Download aborted');
						}

						return await this.downloadChunk(
							this.url,
							chunk.start,
							chunk.end,
							index,
						);
					} catch (error) {
						chunk.status = 'error';
						chunk.error =
							error instanceof Error
								? error.message
								: String(error);
						throw error;
					}
				},
			);

			// Start progress reporting
			const progressTimer = setInterval(() => {
				this.emitProgress();
			}, 200);

			let chunkPaths: string[];
			try {
				chunkPaths = await Promise.all(downloadPromises);
			} finally {
				clearInterval(progressTimer);
			}

			if (this.aborted) {
				throw new Error('Download aborted');
			}

			// 4. Merge chunks
			this.status = 'merging';
			this.emitProgress();
			await this.mergeChunks(chunkPaths);

			// 5. Done
			this.status = 'done';
			this.emitProgress();
		} catch (error) {
			this.status = 'error';
			this.error =
				error instanceof Error ? error.message : String(error);
			this.emitProgress();
		}
	}

	private emitProgress(): void {
		const elapsed = (Date.now() - this.startTime) / 1000;
		const downloaded = this.chunks.reduce(
			(sum, c) => sum + c.downloaded,
			0,
		);
		const speed = elapsed > 0 ? downloaded / elapsed : 0;

		const progress: DownloadProgress = {
			totalSize: this.totalSize,
			downloaded,
			speed,
			chunks: [...this.chunks],
			status: this.status,
			error: this.error,
			filename: this.filename || 'download',
		};

		this.emit('progress', progress);
	}
}
