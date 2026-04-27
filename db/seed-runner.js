import { execSync } from 'child_process';
import { loadEnv } from './load-env.js';

loadEnv();

const command = 'tsx seed.ts';
execSync(command, { stdio: 'inherit' });
