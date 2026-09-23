import { resolve } from 'node:path';
import { createHttpServer } from '../src/interfaces/http/create-http-server.mjs';

const port = Number(process.env.PORT ?? 4173);
const server = createHttpServer({ staticDir: resolve('web/dist') });
server.listen(port, '127.0.0.1', () => console.log(`PriorSeal preview listening on http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
