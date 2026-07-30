import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { appQueryClient } from './src/query/client';

afterEach(() => appQueryClient.clear());
