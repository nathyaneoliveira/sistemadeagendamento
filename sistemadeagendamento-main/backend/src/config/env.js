import dotenv from 'dotenv';
import { buildRuntimeConfig } from './runtimeConfig.js';

dotenv.config();

export const env = buildRuntimeConfig(process.env);
