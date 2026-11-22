import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:5173')
        .split(',').map((origin) => origin.trim()).filter(Boolean);
    app.enableCors({ origin: origins, methods: ['GET', 'OPTIONS'], allowedHeaders: ['Content-Type', 'If-None-Match'], maxAge: 600 });
    app.setGlobalPrefix('api/v1');
    await app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0');
}
void bootstrap();
