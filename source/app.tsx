import React, {useState, useEffect} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import Spinner from 'ink-spinner';
import {
	MultiThreadDownloader,
	type DownloadProgress,
	type ChunkProgress,
} from './downloader.js';

// ── Helpers ─────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
	if (bytes <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const idx = Math.min(i, units.length - 1);
	return `${(bytes / Math.pow(1024, idx)).toFixed(2)} ${units[idx] ?? 'B'}`;
}

function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '--:--:--';
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── ProgressBar ─────────────────────────────────────────────────────

type ProgressBarProps = {
	ratio: number;
	width: number;
	color?: string;
	completeColor?: string;
};

function ProgressBar({
	ratio,
	width,
	color = 'green',
	completeColor,
}: ProgressBarProps) {
	const clamped = Math.max(0, Math.min(1, ratio));
	const filledCount = Math.round(clamped * width);
	const emptyCount = width - filledCount;
	const filled = '█'.repeat(filledCount);
	const empty = '░'.repeat(emptyCount);

	return (
		<Text>
			<Text color={completeColor ?? color}>{filled}</Text>
			<Text color="gray">{empty}</Text>
		</Text>
	);
}

// ── ChunkRow ────────────────────────────────────────────────────────

function ChunkRow({
	chunk,
	barWidth,
}: {
	chunk: ChunkProgress;
	barWidth: number;
}) {
	const ratio = chunk.total > 0 ? chunk.downloaded / chunk.total : 0;
	const percentStr = `${Math.floor(ratio * 100)
		.toString()
		.padStart(3)}%`;

	let indicator: React.ReactElement;
	switch (chunk.status) {
		case 'pending': {
			indicator = <Text color="gray">○ 等待中</Text>;
			break;
		}

		case 'downloading': {
			indicator = (
				<Text color="cyan">
					<Spinner type="dots" /> 下载中
				</Text>
			);
			break;
		}

		case 'done': {
			indicator = <Text color="green">✓ 完成 </Text>;
			break;
		}

		case 'error': {
			indicator = <Text color="red">✗ 错误 </Text>;
			break;
		}

		default: {
			indicator = <Text>  </Text>;
		}
	}

	const barColor = chunk.status === 'done' ? 'green' : 'cyan';

	return (
		<Box flexDirection="row" paddingLeft={2}>
			<Box width={6}>
				<Text dimColor>#{chunk.index}</Text>
			</Box>
			<Box width={barWidth + 2}>
				<ProgressBar ratio={ratio} width={barWidth} color={barColor} />
			</Box>
			<Box width={6}>
				<Text>{percentStr}</Text>
			</Box>
			<Box width={12}>
				<Text dimColor>{formatBytes(chunk.downloaded)}</Text>
			</Box>
			<Box>{indicator}</Box>
		</Box>
	);
}

// ── Main App ────────────────────────────────────────────────────────

type Props = {
	url: string;
	threads: number;
	output?: string;
};

export default function App({url, threads, output}: Props) {
	const {exit} = useApp();
	const [progress, setProgress] = useState<DownloadProgress | null>(null);

	useEffect(() => {
		const downloader = new MultiThreadDownloader(
			url,
			threads,
			output,
		);

		downloader.on('progress', (p: DownloadProgress) => {
			setProgress({...p, chunks: [...p.chunks]});

			if (p.status === 'done' || p.status === 'error') {
				setTimeout(() => {
					exit();
				}, 1500);
			}
		});

		void downloader.start();

		return () => {
			downloader.abort();
		};
	}, [url, threads, output, exit]);

	useInput((_input, key) => {
		if (key.escape || _input === 'q') {
			exit();
		}
	});

	if (!progress) {
		return (
			<Box padding={1}>
				<Text color="cyan">
					<Spinner type="dots" /> 正在连接服务器...
				</Text>
			</Box>
		);
	}

	const overallRatio =
		progress.totalSize > 0
			? progress.downloaded / progress.totalSize
			: 0;
	const overallPercent = `${Math.floor(overallRatio * 100)}%`;
	const eta =
		progress.speed > 0
			? (progress.totalSize - progress.downloaded) / progress.speed
			: 0;

	const barWidth = 30;

	let statusLine: React.ReactElement;
	switch (progress.status) {
		case 'connecting': {
			statusLine = (
				<Text color="cyan">
					<Spinner type="dots" /> 正在连接服务器...
				</Text>
			);
			break;
		}

		case 'downloading': {
			statusLine = (
				<Text color="cyan">
					<Spinner type="dots" /> 正在下载 · 按 q 或 Esc 取消
				</Text>
			);
			break;
		}

		case 'merging': {
			statusLine = (
				<Text color="yellow">
					<Spinner type="dots" /> 正在合并文件...
				</Text>
			);
			break;
		}

		case 'done': {
			statusLine = (
				<Text color="green" bold>
					✓ 下载完成！已保存到: {output || progress.filename}
				</Text>
			);
			break;
		}

		case 'error': {
			statusLine = (
				<Text color="red">✗ 下载失败: {progress.error}</Text>
			);
			break;
		}

		default: {
			statusLine = <Text />;
		}
	}

	return (
		<Box flexDirection="column" padding={1}>
			{/* ── Header ── */}
			<Box marginBottom={1}>
				<Text bold>⬇ 多线程下载器</Text>
			</Box>

			<Box>
				<Text dimColor>文件: </Text>
				<Text color="white" bold>
					{progress.filename}
				</Text>
			</Box>

			{progress.totalSize > 0 && (
				<Box marginBottom={1}>
					<Text dimColor>大小: </Text>
					<Text>{formatBytes(progress.totalSize)}</Text>
					<Text dimColor>  ·  线程: </Text>
					<Text>{progress.chunks.length}</Text>
				</Box>
			)}

			{/* ── Overall progress ── */}
			<Box flexDirection="column" marginBottom={1}>
				<Box>
					<Box width={barWidth + 2}>
						<ProgressBar
							ratio={overallRatio}
							width={barWidth}
							color="green"
						/>
					</Box>
					<Box width={7}>
						<Text bold color="green">
							{overallPercent}
						</Text>
					</Box>
					<Box width={16}>
						<Text color="yellow">{formatBytes(progress.speed)}/s</Text>
					</Box>
					<Text dimColor>
						{formatBytes(progress.downloaded)}
						{progress.totalSize > 0
							? ` / ${formatBytes(progress.totalSize)}`
							: ''}
					</Text>
					{progress.status === 'downloading' &&
						progress.totalSize > 0 && (
							<Text dimColor>  ETA {formatTime(eta)}</Text>
						)}
				</Box>
			</Box>

			{/* ── Separator ── */}
			<Box marginBottom={1}>
				<Text dimColor>{'─'.repeat(70)}</Text>
			</Box>

			{/* ── Chunk rows ── */}
			{progress.chunks.map(chunk => (
				<ChunkRow
					key={chunk.index}
					chunk={chunk}
					barWidth={barWidth}
				/>
			))}

			{/* ── Separator ── */}
			<Box marginTop={1} marginBottom={1}>
				<Text dimColor>{'─'.repeat(70)}</Text>
			</Box>

			{/* ── Status ── */}
			{statusLine}
		</Box>
	);
}
