import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Budget } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';

interface PeriodRange {
  start: Date;
  end: Date;
}

@Injectable()
export class BudgetsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateBudgetDto) {
    await this.assertExpenseCategory(userId, dto.categoryId);

    const budget = await this.prisma.budget.create({
      data: {
        userId,
        categoryId: dto.categoryId,
        amount: BigInt(dto.amount),
        period: dto.period,
        startDate: new Date(dto.startDate),
      },
    });

    return this.withUsage(budget);
  }

  async findAll(userId: string) {
    const budgets = await this.prisma.budget.findMany({
      where: { userId },
      orderBy: { startDate: 'desc' },
    });
    return Promise.all(budgets.map((budget) => this.withUsage(budget)));
  }

  async findOne(userId: string, id: string) {
    const budget = await this.getOwned(userId, id);
    return this.withUsage(budget);
  }

  async update(userId: string, id: string, dto: UpdateBudgetDto) {
    const existing = await this.getOwned(userId, id);

    if (dto.categoryId && dto.categoryId !== existing.categoryId) {
      await this.assertExpenseCategory(userId, dto.categoryId);
    }

    const updated = await this.prisma.budget.update({
      where: { id },
      data: {
        categoryId: dto.categoryId,
        amount: dto.amount !== undefined ? BigInt(dto.amount) : undefined,
        period: dto.period,
        startDate: dto.startDate !== undefined ? new Date(dto.startDate) : undefined,
      },
    });

    return this.withUsage(updated);
  }

  async remove(userId: string, id: string) {
    await this.getOwned(userId, id);
    await this.prisma.budget.delete({ where: { id } });
    return { id };
  }

  private async getOwned(userId: string, id: string): Promise<Budget> {
    const budget = await this.prisma.budget.findUnique({ where: { id } });
    if (!budget) {
      throw new NotFoundException('예산을 찾을 수 없습니다.');
    }
    if (budget.userId !== userId) {
      throw new ForbiddenException('접근 권한이 없습니다.');
    }
    return budget;
  }

  private async assertExpenseCategory(userId: string, categoryId: string) {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!category || category.userId !== userId) {
      throw new NotFoundException('카테고리를 찾을 수 없습니다.');
    }
    if (category.type !== 'EXPENSE') {
      throw new BadRequestException(
        '예산은 지출(EXPENSE) 카테고리에만 설정할 수 있습니다.',
      );
    }
  }

  // 예산은 startDate를 기준으로 MONTHLY/WEEKLY 주기로 반복된다고 보고,
  // "지금 시점이 속한 기간"의 지출 합계 대비 사용률을 계산해서 함께 내려준다.
  private async withUsage(budget: Budget) {
    const now = new Date();
    const range =
      budget.period === 'MONTHLY'
        ? this.getMonthlyPeriod(budget.startDate, now)
        : this.getWeeklyPeriod(budget.startDate, now);

    const result = await this.prisma.transaction.aggregate({
      _sum: { amount: true },
      where: {
        userId: budget.userId,
        categoryId: budget.categoryId,
        type: 'EXPENSE',
        date: { gte: range.start, lt: range.end },
      },
    });

    const spent = result._sum.amount ?? 0n;
    const remaining = budget.amount - spent;
    const usageRate = budget.amount > 0n ? Number(spent) / Number(budget.amount) : 0;

    return {
      ...budget,
      periodStart: range.start,
      periodEnd: range.end,
      spent,
      remaining,
      usageRate,
    };
  }

  private getWeeklyPeriod(startDate: Date, now: Date): PeriodRange {
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    if (now < startDate) {
      return { start: startDate, end: new Date(startDate.getTime() + WEEK_MS) };
    }
    const weeksElapsed = Math.floor((now.getTime() - startDate.getTime()) / WEEK_MS);
    const start = new Date(startDate.getTime() + weeksElapsed * WEEK_MS);
    return { start, end: new Date(start.getTime() + WEEK_MS) };
  }

  private getMonthlyPeriod(startDate: Date, now: Date): PeriodRange {
    const day = startDate.getUTCDate();
    if (now < startDate) {
      return { start: startDate, end: this.addMonths(startDate, 1, day) };
    }
    let candidate = this.setDayClamped(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      day,
      startDate,
    );
    if (candidate > now) {
      candidate = this.addMonths(candidate, -1, day);
    }
    if (candidate < startDate) {
      candidate = startDate;
    }
    return { start: candidate, end: this.addMonths(candidate, 1, day) };
  }

  // 31일처럼 다음 달에 없는 날짜는 그 달의 말일로 클램프한다
  // (예: 1/31 기준 -> 2월은 2/28, 3월은 다시 3/31로 원래 날짜를 유지).
  // day는 항상 startDate의 날짜를 그대로 전달해야, 짧은 달을 거친 뒤에도
  // "원래 몇 일에 반복되어야 하는지"가 유지된다 (date 자체의 날짜를 읽으면
  // 클램프된 값이 누적돼 매번 날짜가 줄어드는 문제가 생긴다).
  private addMonths(date: Date, months: number, day: number): Date {
    const base = new Date(date);
    base.setUTCDate(1);
    base.setUTCMonth(base.getUTCMonth() + months);
    return this.setDayClamped(base.getUTCFullYear(), base.getUTCMonth(), day, date);
  }

  private setDayClamped(year: number, month: number, day: number, timeSource: Date): Date {
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(
      Date.UTC(
        year,
        month,
        Math.min(day, daysInMonth),
        timeSource.getUTCHours(),
        timeSource.getUTCMinutes(),
        timeSource.getUTCSeconds(),
      ),
    );
  }
}
