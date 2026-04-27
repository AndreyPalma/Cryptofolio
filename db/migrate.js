import { execSync } from 'child_process';
import { loadEnv } from './load-env.js';

loadEnv();

const command = `node-pg-migrate ${process.argv[2]} --config-file .node-pg-migrate.json`;
execSync(command, { stdio: 'inherit' });
