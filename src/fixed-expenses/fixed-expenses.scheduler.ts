import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FixedExpensesService } from './fixed-expenses.service';

@Injectable()
export class FixedExpensesScheduler {
  private readonly logger = new Logger(FixedExpensesScheduler.name);

  constructor(private readonly fixedExpensesService: FixedExpensesService) {}

  // 매일 자정(서버 시간) 실행. 서버가 그날 꺼져있었어도 다음 실행 때
  // FixedExpensesService.generateDueTransactions가 이번 달 미생성분을 알아서
  // 따라잡는다.
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyGeneration() {
    const generated = await this.fixedExpensesService.generateDueTransactions();
    if (generated > 0) {
      this.logger.log(`고정지출 ${generated}건을 거래로 생성했습니다.`);
    }
  }
}
