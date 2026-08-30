import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RenewalHistory } from './renewal-history.entity';
import { RenewalHistoryService } from './renewal-history.service';
import { RenewalHistoryController } from './renewal-history.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RenewalHistory])],
  controllers: [RenewalHistoryController],
  providers: [RenewalHistoryService],
  exports: [RenewalHistoryService], // exported so SubscriptionsService can call record()
})
export class RenewalHistoryModule {}
