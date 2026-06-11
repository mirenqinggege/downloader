import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import App from './source/app.js';

test('renders connecting state', t => {
	const {lastFrame} = render(
		<App url="https://example.com/test.zip" threads={4} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.true(typeof output === 'string');
});

test('renders with custom output path', t => {
	const {lastFrame} = render(
		<App
			url="https://example.com/test.zip"
			threads={2}
			output="./out.zip"
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.true(typeof output === 'string');
});
