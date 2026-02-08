import { start } from './app';

if (process.env.NODE_ENV !== 'test') {
  start();
}
