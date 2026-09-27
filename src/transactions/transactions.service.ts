import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Transaction, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { FindTransactionsQueryDto } from './dto/find-transactions-query.dto';
import { FindDailySummaryQueryDto } from './dto/find-daily-summary-query.dto';

export interface DailySummary {
  date: string;
  income: bigint;
  expense: bigint;
}

interface RelationInput {
  accountId: string;
  type: TransactionType;
  transferAccountId: string | null;
  categoryId: string | null;
}

type BalanceEffectInput = Pick<
  Transaction,
  'accountId' | 'transferAccountId' | 'amount' | 'type'
>;

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateTransactionDto) {
    await this.validateRelations(userId, {
      accountId: dto.accountId,
      type: dto.type,
      transferAccountId: dto.transferAccountId ?? null,
      categoryId: dto.categoryId ?? null,
    });

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          userId,
          accountId: dto.accountId,
          categoryId: dto.categoryId ?? null,
          title: dto.title,
          amount: BigInt(dto.amount),
          type: dto.type,
          transferAccountId: dto.transferAccountId ?? null,
          date: new Date(dto.date),
          memo: dto.memo,
          isAuto: dto.isAuto ?? false,
          source: dto.source,
        },
      });
      await this.applyBalanceEffect(tx, created, 1n);
      return created;
    });
  }

  findAll(userId: string, query: FindTransactionsQueryDto) {
    return this.prisma.transaction.findMany({
      where: {
        userId,
        accountId: query.accountId,
        categoryId: query.categoryId,
        type: query.type,
        date: {
          gte: query.from ? new Date(query.from) : undefined,
          lte: query.to ? new Date(query.to) : undefined,
        },
      },
      orderBy: { date: 'desc' },
      skip: query.skip,
      take: query.take,
    });
  }

  // 캘린더 화면용: 지정한 달의 날짜별 수입/지출 합계. 프론트가 들고 있는
  // 캐시된 거래 목록(최근 6개월)과 무관하게, 어떤 달이든 DB에서 바로
  // 집계해서 내려준다 — 캘린더에서 임의의 과거/미래 달로 이동해도 동작함.
  async dailySummary(
    userId: string,
    query: FindDailySummaryQueryDto,
  ): Promise<DailySummary[]> {
    const start = new Date(Date.UTC(query.year, query.month - 1, 1));
    const end = new Date(Date.UTC(query.year, query.month, 1));

    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: start, lt: end },
        type: { in: ['INCOME', 'EXPENSE'] },
      },
      select: { date: true, type: true, amount: true },
    });

    const byDay = new Map<string, DailySummary>();
    for (const row of rows) {
      const day = row.date.toISOString().slice(0, 10);
      const entry = byDay.get(day) ?? { date: day, income: 0n, expense: 0n };
      if (row.type === 'INCOME') entry.income += row.amount;
      else entry.expense += row.amount;
      byDay.set(day, entry);
    }
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  async findOne(userId: string, id: string) {
    const transaction = await this.prisma.transaction.findUnique({ where: { id } });
    if (!transaction) {
      throw new NotFoundException('거래 내역을 찾을 수 없습니다.');
    }
    if (transaction.userId !== userId) {
      throw new ForbiddenException('접근 권한이 없습니다.');
    }
    return transaction;
  }

  async update(userId: string, id: string, dto: UpdateTransactionDto) {
    const existing = await this.findOne(userId, id);

    const accountId = dto.accountId ?? existing.accountId;
    const type = dto.type ?? existing.type;
    const transferAccountId =
      dto.transferAccountId !== undefined
        ? dto.transferAccountId
        : existing.transferAccountId;
    const categoryId =
      dto.categoryId !== undefined ? dto.categoryId : existing.categoryId;
    const amount = dto.amount !== undefined ? BigInt(dto.amount) : existing.amount;
    const date = dto.date !== undefined ? new Date(dto.date) : existing.date;

    await this.validateRelations(userId, {
      accountId,
      type,
      transferAccountId,
      categoryId,
    });

    return this.prisma.$transaction(async (tx) => {
      // 기존 거래가 계좌 잔액에 준 영향을 먼저 되돌린다.
      await this.applyBalanceEffect(tx, existing, -1n);

      const updated = await tx.transaction.update({
        where: { id },
        data: {
          accountId,
          categoryId,
          amount,
          type,
          transferAccountId,
          date,
          title: dto.title !== undefined ? dto.title : existing.title,
          memo: dto.memo !== undefined ? dto.memo : existing.memo,
          isAuto: dto.isAuto !== undefined ? dto.isAuto : existing.isAuto,
          source: dto.source !== undefined ? dto.source : existing.source,
        },
      });

      await this.applyBalanceEffect(tx, updated, 1n);
      return updated;
    });
  }

  async remove(userId: string, id: string) {
    const existing = await this.findOne(userId, id);

    return this.prisma.$transaction(async (tx) => {
      await this.applyBalanceEffect(tx, existing, -1n);
      await tx.transaction.delete({ where: { id } });
      return { id };
    });
  }

  private async validateRelations(userId: string, input: RelationInput) {
    const account = await this.prisma.account.findUnique({
      where: { id: input.accountId },
    });
    if (!account || account.userId !== userId) {
      throw new NotFoundException('계좌를 찾을 수 없습니다.');
    }

    if (input.type === 'TRANSFER') {
      if (!input.transferAccountId) {
        throw new BadRequestException(
          '이체 거래는 받는 계좌(transferAccountId)가 필요합니다.',
        );
      }
      if (input.transferAccountId === input.accountId) {
        throw new BadRequestException('같은 계좌로는 이체할 수 없습니다.');
      }
      const transferAccount = await this.prisma.account.findUnique({
        where: { id: input.transferAccountId },
      });
      if (!transferAccount || transferAccount.userId !== userId) {
        throw new NotFoundException('이체 대상 계좌를 찾을 수 없습니다.');
      }
      if (input.categoryId) {
        throw new BadRequestException('이체 거래에는 카테고리를 지정할 수 없습니다.');
      }
    } else if (input.transferAccountId) {
      throw new BadRequestException(
        '이체 거래가 아닌 경우 transferAccountId를 지정할 수 없습니다.',
      );
    }

    if (input.categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: input.categoryId },
      });
      if (!category || category.userId !== userId) {
        throw new NotFoundException('카테고리를 찾을 수 없습니다.');
      }
      if (category.type !== input.type) {
        throw new BadRequestException(
          '카테고리 타입이 거래 타입과 일치해야 합니다.',
        );
      }
    }
  }

  // direction: 1n = 거래 효과를 잔액에 적용, -1n = 되돌림
  private async applyBalanceEffect(
    tx: Prisma.TransactionClient,
    record: BalanceEffectInput,
    direction: 1n | -1n,
  ) {
    const { accountDelta, transferAccountDelta } = this.computeDeltas(
      record.type,
      record.amount,
    );

    await tx.account.update({
      where: { id: record.accountId },
      data: { balance: { increment: accountDelta * direction } },
    });

    if (record.type === 'TRANSFER' && record.transferAccountId) {
      await tx.account.update({
        where: { id: record.transferAccountId },
        data: { balance: { increment: (transferAccountDelta ?? 0n) * direction } },
      });
    }
  }

  private computeDeltas(
    type: TransactionType,
    amount: bigint,
  ): { accountDelta: bigint; transferAccountDelta?: bigint } {
    switch (type) {
      case 'INCOME':
        return { accountDelta: amount };
      case 'EXPENSE':
        return { accountDelta: -amount };
      case 'TRANSFER':
        return { accountDelta: -amount, transferAccountDelta: amount };
    }
  }
}
