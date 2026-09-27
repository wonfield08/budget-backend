import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { createPrismaMock, asPrismaService, MockPrismaService } from '../test/prisma-mock';

describe('TransactionsService', () => {
  let service: TransactionsService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new TransactionsService(asPrismaService(prisma));
  });

  const account = (id: string, userId = 'u1') => ({ id, userId });

  describe('create - 잔액 반영', () => {
    it('INCOME은 계좌 잔액을 +amount 한다', async () => {
      prisma.account.findUnique.mockResolvedValue(account('acc1'));
      prisma.transaction.create.mockResolvedValue({
        id: 't1',
        accountId: 'acc1',
        transferAccountId: null,
        amount: 1000n,
        type: 'INCOME',
      });

      await service.create('u1', {
        accountId: 'acc1',
        amount: 1000,
        type: 'INCOME' as any,
        title: '테스트 거래',
        date: '2026-01-01',
      });

      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 'acc1' },
        data: { balance: { increment: 1000n } },
      });
    });

    it('EXPENSE는 계좌 잔액을 -amount 한다', async () => {
      prisma.account.findUnique.mockResolvedValue(account('acc1'));
      prisma.transaction.create.mockResolvedValue({
        id: 't1',
        accountId: 'acc1',
        transferAccountId: null,
        amount: 1000n,
        type: 'EXPENSE',
      });

      await service.create('u1', {
        accountId: 'acc1',
        amount: 1000,
        type: 'EXPENSE' as any,
        title: '테스트 거래',
        date: '2026-01-01',
      });

      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 'acc1' },
        data: { balance: { increment: -1000n } },
      });
    });

    it('TRANSFER는 출금 계좌 -amount, 입금 계좌 +amount 한다', async () => {
      prisma.account.findUnique.mockImplementation(({ where: { id } }: any) =>
        Promise.resolve(account(id)),
      );
      prisma.transaction.create.mockResolvedValue({
        id: 't1',
        accountId: 'acc1',
        transferAccountId: 'acc2',
        amount: 500n,
        type: 'TRANSFER',
      });

      await service.create('u1', {
        accountId: 'acc1',
        transferAccountId: 'acc2',
        amount: 500,
        type: 'TRANSFER' as any,
        title: '테스트 거래',
        date: '2026-01-01',
      });

      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 'acc1' },
        data: { balance: { increment: -500n } },
      });
      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 'acc2' },
        data: { balance: { increment: 500n } },
      });
    });
  });

  describe('create - 유효성 검증', () => {
    it('계좌가 없으면 NotFoundException', async () => {
      prisma.account.findUnique.mockResolvedValue(null);

      await expect(
        service.create('u1', {
          accountId: 'missing',
          amount: 1000,
          type: 'INCOME' as any,
          title: '테스트 거래',
          date: '2026-01-01',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('TRANSFER인데 transferAccountId가 없으면 BadRequestException', async () => {
      prisma.account.findUnique.mockResolvedValue(account('acc1'));

      await expect(
        service.create('u1', {
          accountId: 'acc1',
          amount: 1000,
          type: 'TRANSFER' as any,
          title: '테스트 거래',
          date: '2026-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('같은 계좌로 이체하면 BadRequestException', async () => {
      prisma.account.findUnique.mockResolvedValue(account('acc1'));

      await expect(
        service.create('u1', {
          accountId: 'acc1',
          transferAccountId: 'acc1',
          amount: 1000,
          type: 'TRANSFER' as any,
          title: '테스트 거래',
          date: '2026-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('TRANSFER가 아닌데 transferAccountId를 지정하면 BadRequestException', async () => {
      prisma.account.findUnique.mockResolvedValue(account('acc1'));

      await expect(
        service.create('u1', {
          accountId: 'acc1',
          transferAccountId: 'acc2',
          amount: 1000,
          type: 'INCOME' as any,
          title: '테스트 거래',
          date: '2026-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('카테고리 타입이 거래 타입과 다르면 BadRequestException', async () => {
      prisma.account.findUnique.mockResolvedValue(account('acc1'));
      prisma.category.findUnique.mockResolvedValue({
        id: 'cat1',
        userId: 'u1',
        type: 'INCOME',
      });

      await expect(
        service.create('u1', {
          accountId: 'acc1',
          categoryId: 'cat1',
          amount: 1000,
          type: 'EXPENSE' as any,
          title: '테스트 거래',
          date: '2026-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('기존 잔액 효과를 되돌리고 새 값으로 다시 반영한다', async () => {
      prisma.transaction.findUnique.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        accountId: 'acc1',
        categoryId: null,
        transferAccountId: null,
        amount: 1000n,
        type: 'EXPENSE',
        date: new Date('2026-01-01'),
        memo: null,
        isAuto: false,
        source: null,
      });
      prisma.account.findUnique.mockResolvedValue(account('acc1'));
      prisma.transaction.update.mockResolvedValue({
        id: 't1',
        accountId: 'acc1',
        transferAccountId: null,
        amount: 2000n,
        type: 'EXPENSE',
      });

      await service.update('u1', 't1', { amount: 2000 });

      // 1) 기존 EXPENSE(1000) 되돌림: +1000
      expect(prisma.account.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'acc1' },
        data: { balance: { increment: 1000n } },
      });
      // 2) 새 EXPENSE(2000) 반영: -2000
      expect(prisma.account.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'acc1' },
        data: { balance: { increment: -2000n } },
      });
    });
  });

  describe('remove', () => {
    it('삭제 시 기존 잔액 효과를 되돌린다', async () => {
      prisma.transaction.findUnique.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        accountId: 'acc1',
        transferAccountId: null,
        amount: 1000n,
        type: 'INCOME',
      });

      const result = await service.remove('u1', 't1');

      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 'acc1' },
        data: { balance: { increment: -1000n } },
      });
      expect(prisma.transaction.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
      expect(result).toEqual({ id: 't1' });
    });
  });

  describe('dailySummary', () => {
    it('날짜별로 INCOME/EXPENSE 합계를 묶어서 날짜순으로 반환한다', async () => {
      prisma.transaction.findMany.mockResolvedValue([
        { date: new Date('2026-09-05T03:00:00.000Z'), type: 'EXPENSE', amount: 4000n },
        { date: new Date('2026-09-05T10:00:00.000Z'), type: 'EXPENSE', amount: 1000n },
        { date: new Date('2026-09-03T00:00:00.000Z'), type: 'INCOME', amount: 30000n },
      ]);

      const result = await service.dailySummary('u1', { year: 2026, month: 9 });

      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'u1',
          date: { gte: new Date(Date.UTC(2026, 8, 1)), lt: new Date(Date.UTC(2026, 9, 1)) },
          type: { in: ['INCOME', 'EXPENSE'] },
        },
        select: { date: true, type: true, amount: true },
      });
      expect(result).toEqual([
        { date: '2026-09-03', income: 30000n, expense: 0n },
        { date: '2026-09-05', income: 0n, expense: 5000n },
      ]);
    });

    it('거래가 없으면 빈 배열을 반환한다', async () => {
      prisma.transaction.findMany.mockResolvedValue([]);

      const result = await service.dailySummary('u1', { year: 2026, month: 9 });

      expect(result).toEqual([]);
    });
  });
});
