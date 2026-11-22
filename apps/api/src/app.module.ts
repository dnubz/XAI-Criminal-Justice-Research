import { Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { PublishedDataService } from './published-data.service';
import { PublicDataCacheInterceptor } from './public-data-cache.interceptor';
@Module({ controllers: [ApiController], providers: [PublishedDataService, PublicDataCacheInterceptor] })
export class AppModule {
}
