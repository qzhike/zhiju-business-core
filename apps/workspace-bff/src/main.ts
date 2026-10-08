import { createBff } from './app.js';

const app = await createBff();
await app.listen(Number(process.env.PORT ?? 3101), '127.0.0.1');
