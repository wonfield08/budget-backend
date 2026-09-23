import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { FixedExpensesController } from './fixed-expenses.controller';
import { FixedExpensesService } from './fixed-expenses.service';
import { FixedExpensesScheduler } from './fixed-expenses.scheduler';

@Module({
  imports: [TransactionsModule],
  controllers: [FixedExpensesController],
  providers: [FixedExpensesService, FixedExpensesScheduler],
  exports: [FixedExpensesService],
})
export class FixedExpensesModule {}
