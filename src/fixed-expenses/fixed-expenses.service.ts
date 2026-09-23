import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FixedExpense } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { CreateFixedExpenseDto } from './dto/create-fixed-expense.dto';
import { UpdateFixedExpenseDto } from './dto/update-fixed-expense.dto';

@Injectable()
export class FixedExpensesService {
  private readonly logger = new Logger(FixedExpensesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionsService: TransactionsService,
  ) {}

  async create(userId: string, dto: CreateFixedExpenseDto) {
    await this.assertOwnedAccount(userId, dto.accountId);
    if (dto.categoryId) {
      await this.assertOwnedExpenseCategory(userId, dto.categoryId);
    }

    return this.prisma.fixedExpense.create({
      data: {
        userId,
        accountId: dto.accountId,
        categoryId: dto.categoryId ?? null,
        title: dto.title,
        amount: BigInt(dto.amount),
        dayOfMonth: dto.dayOfMonth,
        memo: dto.memo,
      },
    });
  }

  findAll(userId: string) {
    return this.prisma.fixedExpense.findMany({
      where: { userId },
      orderBy: { dayOfMonth: 'asc' },
    });
  }

  async findOne(userId: string, id: string) {
    return this.getOwned(userId, id);
  }

  async update(userId: string, id: string, dto: UpdateFixedExpenseDto) {
    const existing = await this.getOwned(userId, id);

    if (dto.accountId && dto.accountId !== existing.accountId) {
      await this.assertOwnedAccount(userId, dto.accountId);
    }
    if (dto.categoryId && dto.categoryId !== existing.categoryId) {
      await this.assertOwnedExpenseCategory(userId, dto.categoryId);
    }

    return this.prisma.fixedExpense.update({
      where: { id },
      data: {
        accountId: dto.accountId,
        categoryId: dto.categoryId,
        title: dto.title,
        amount: dto.amount !== undefined ? BigInt(dto.amount) : undefined,
        dayOfMonth: dto.dayOfMonth,
        memo: dto.memo,
        active: dto.active,
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.getOwned(userId, id);
    await this.prisma.fixedExpense.delete({ where: { id } });
    return { id };
  }

  private async getOwned(userId: string, id: string): Promise<FixedExpense> {
    const fixedExpense = await this.prisma.fixedExpense.findUnique({ where: { id } });
    if (!fixedExpense) {
      throw new NotFoundException('고정지출을 찾을 수 없습니다.');
    }
    if (fixedExpense.userId !== userId) {
      throw new ForbiddenException('접근 권한이 없습니다.');
    }
    return fixedExpense;
  }

  private async assertOwnedAccount(userId: string, accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.userId !== userId) {
      throw new NotFoundException('계좌를 찾을 수 없습니다.');
    }
  }

  private async assertOwnedExpenseCategory(userId: string, categoryId: string) {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category || category.userId !== userId) {
      throw new NotFoundException('카테고리를 찾을 수 없습니다.');
    }
    if (category.type !== 'EXPENSE') {
      throw new BadRequestException(
        '고정지출은 지출(EXPENSE) 카테고리에만 설정할 수 있습니다.',
      );
    }
  }

  private sourceTag(fixedExpenseId: string): string {
    return `fixed-expense:${fixedExpenseId}`;
  }

  // 31일처럼 그 달에 없는 날짜는 말일로 클램프한다 (budgets.service의
  // setDayClamped와 동일한 로직).
  private clampedDay(year: number, month: number, day: number): number {
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return Math.min(day, daysInMonth);
  }

  // 매일 실행되는 스케줄러가 호출한다: 아직 이번 달 거래가 생성되지 않았고
  // 오늘이 (클램프된) dayOfMonth 이상인 고정지출을 찾아 Transaction으로
  // 실체화한다. 서버가 며칠 꺼져있었어도 다음 실행 때 이번 달분을 놓치지
  // 않고 따라잡는다 (매달 1건만 생성되도록 source 태그로 중복 방지).
  async generateDueTransactions(now = new Date()): Promise<number> {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const today = now.getUTCDate();
    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd = new Date(Date.UTC(year, month + 1, 1));

    const dueExpenses = await this.prisma.fixedExpense.findMany({
      where: { active: true },
    });

    let generated = 0;
    for (const expense of dueExpenses) {
      const effectiveDay = this.clampedDay(year, month, expense.dayOfMonth);
      if (today < effectiveDay) continue;

      const source = this.sourceTag(expense.id);
      const alreadyGenerated = await this.prisma.transaction.findFirst({
        where: { source, date: { gte: monthStart, lt: monthEnd } },
      });
      if (alreadyGenerated) continue;

      try {
        await this.transactionsService.create(expense.userId, {
          accountId: expense.accountId,
          categoryId: expense.categoryId ?? undefined,
          title: expense.title,
          amount: Number(expense.amount),
          type: 'EXPENSE',
          date: new Date(Date.UTC(year, month, effectiveDay)).toISOString(),
          memo: expense.memo ?? undefined,
          isAuto: true,
          source,
        });
        generated++;
      } catch (err) {
        this.logger.error(
          `고정지출 ${expense.id} 거래 생성 실패: ${(err as Error).message}`,
        );
      }
    }
    return generated;
  }
}
