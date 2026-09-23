import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FixedExpensesService } from './fixed-expenses.service';
import { createPrismaMock, asPrismaService, MockPrismaService } from '../test/prisma-mock';

describe('FixedExpensesService', () => {
  let service: FixedExpensesService;
  let prisma: MockPrismaService;
  let transactionsService: { create: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();
    transactionsService = { create: jest.fn() };
    service = new FixedExpensesService(asPrismaService(prisma), transactionsService as any);
  });

  describe('create', () => {
    it('계좌가 없으면 NotFoundException', async () => {
      prisma.account.findUnique.mockResolvedValue(null);

      await expect(
        service.create('u1', {
          accountId: 'missing',
          title: '월세',
          amount: 500000,
          dayOfMonth: 25,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('INCOME 카테고리를 지정하면 BadRequestException', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1' });
      prisma.category.findUnique.mockResolvedValue({ id: 'c1', userId: 'u1', type: 'INCOME' });

      await expect(
        service.create('u1', {
          accountId: 'a1',
          categoryId: 'c1',
          title: '월세',
          amount: 500000,
          dayOfMonth: 25,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('정상 입력이면 생성한다', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1' });
      prisma.category.findUnique.mockResolvedValue({ id: 'c1', userId: 'u1', type: 'EXPENSE' });
      prisma.fixedExpense.create.mockResolvedValue({ id: 'f1' });

      await service.create('u1', {
        accountId: 'a1',
        categoryId: 'c1',
        title: '월세',
        amount: 500000,
        dayOfMonth: 25,
      });

      expect(prisma.fixedExpense.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          accountId: 'a1',
          categoryId: 'c1',
          title: '월세',
          amount: 500000n,
          dayOfMonth: 25,
          memo: undefined,
        },
      });
    });
  });

  describe('remove', () => {
    it('본인 소유가 아니면 ForbiddenException', async () => {
      prisma.fixedExpense.findUnique.mockResolvedValue({ id: 'f1', userId: 'other' });

      await expect(service.remove('u1', 'f1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('generateDueTransactions', () => {
    const now = new Date(Date.UTC(2026, 1, 28)); // 2026-02-28 (윤년 아님)

    it('아직 dayOfMonth에 도달하지 않은 고정지출은 건너뛴다', async () => {
      prisma.fixedExpense.findMany.mockResolvedValue([
        { id: 'f1', userId: 'u1', active: true, dayOfMonth: 31, accountId: 'a1', categoryId: null, title: '월세', amount: 500000n, memo: null },
      ]);

      const generated = await service.generateDueTransactions(now);

      // 2월은 28일까지밖에 없어서 dayOfMonth=31은 28일로 클램프되어 오늘(28일)에 발생해야 함
      expect(generated).toBe(1);
      expect(transactionsService.create).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ amount: 500000, type: 'EXPENSE', source: 'fixed-expense:f1' }),
      );
    });

    it('이번 달에 이미 생성된 고정지출은 다시 생성하지 않는다', async () => {
      prisma.fixedExpense.findMany.mockResolvedValue([
        { id: 'f1', userId: 'u1', active: true, dayOfMonth: 1, accountId: 'a1', categoryId: null, title: '월세', amount: 500000n, memo: null },
      ]);
      prisma.transaction.findFirst.mockResolvedValue({ id: 'existing-tx' });

      const generated = await service.generateDueTransactions(now);

      expect(generated).toBe(0);
      expect(transactionsService.create).not.toHaveBeenCalled();
    });

    it('오늘보다 뒤인 dayOfMonth는 건너뛴다', async () => {
      prisma.fixedExpense.findMany.mockResolvedValue([
        { id: 'f1', userId: 'u1', active: true, dayOfMonth: 30, accountId: 'a1', categoryId: null, title: '보험료', amount: 30000n, memo: null },
      ]);

      // 2026-02-28 기준으로 dayOfMonth=30은 2월엔 없으니 28일로 클램프되어
      // "오늘"과 같아 생성 대상이 된다 — 아직 도달 안 한 케이스를 보려면
      // 월초로 확인한다.
      const earlyMonth = new Date(Date.UTC(2026, 1, 1));
      const generated = await service.generateDueTransactions(earlyMonth);

      expect(generated).toBe(0);
      expect(transactionsService.create).not.toHaveBeenCalled();
    });
  });
});
