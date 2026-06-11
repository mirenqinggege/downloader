#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import App from './app.js';

const cli = meow(
	`
	Usage
	  $ downloader <url>

	Options
	  --threads, -t   下载线程数 (默认: 4)
	  --output,  -o   输出文件路径 (默认: 自动检测)

	Examples
	  $ downloader https://example.com/file.zip
	  $ downloader https://example.com/file.zip --threads=8
	  $ downloader https://example.com/file.zip -o ./output.zip -t 8
`,
	{
		importMeta: import.meta,
		flags: {
			threads: {
				type: 'number',
				shortFlag: 't',
				default: 4,
			},
			output: {
				type: 'string',
				shortFlag: 'o',
			},
		},
	},
);

const url = cli.input[0];

if (!url) {
	console.error('错误: 请提供下载 URL');
	console.error('用法: downloader <url>');
	console.error('示例: downloader https://example.com/file.zip');
	process.exit(1);
}

render(
	<App url={url} threads={cli.flags.threads} output={cli.flags.output} />,
);
