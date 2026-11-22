import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';
let appPromise: ReturnType<typeof bootstrap> | undefined;
async function bootstrap() {
    const app = await NestFactory.create(AppModule, { bufferLogs: true });
    app.enableCors({
        origin: (process.env.CORS_ORIGINS ?? '')
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
        methods: ['GET', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'If-None-Match'],
        maxAge: 600,
    });
    app.setGlobalPrefix('api/v1');
    await app.init();
    return app;
}
export default async function handler(req: Request, res: Response) {
    appPromise ??= bootstrap();
    const app = await appPromise;
    return app.getHttpAdapter().getInstance()(req, res);
}
