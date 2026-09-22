import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { createPrismaMock, asPrismaService, MockPrismaService } from '../test/prisma-mock';

describe('BudgetsService', () => {
  let service: BudgetsService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new BudgetsService(asPrismaService(prisma));
    prisma.transaction.aggregate.mockResolvedValue({ _sum: { amount: 3000n } });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('create', () => {
    it('카테고리가 없으면 NotFoundException', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.create('u1', {
          categoryId: 'missing',
          amount: 100000,
          period: 'MONTHLY' as any,
          startDate: '2026-01-01',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('INCOME 카테고리면 BadRequestException', async () => {
      prisma.category.findUnique.mockResolvedValue({
        id: 'cat1',
        userId: 'u1',
        type: 'INCOME',
      });

      await expect(
        service.create('u1', {
          categoryId: 'cat1',
          amount: 100000,
          period: 'MONTHLY' as any,
          startDate: '2026-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('EXPENSE 카테고리면 생성하고 사용률을 함께 반환한다', async () => {
      prisma.category.findUnique.mockResolvedValue({
        id: 'cat1',
        userId: 'u1',
        type: 'EXPENSE',
      });
      prisma.budget.create.mockResolvedValue({
        id: 'b1',
        userId: 'u1',
        categoryId: 'cat1',
        amount: 100000n,
        period: 'MONTHLY',
        startDate: new Date('2026-01-01'),
      });

      const result = await service.create('u1', {
        categoryId: 'cat1',
        amount: 100000,
        period: 'MONTHLY' as any,
        startDate: '2026-01-01',
      });

      expect(result.spent).toBe(3000n);
      expect(result.remaining).toBe(97000n);
      expect(result.usageRate).toBeCloseTo(0.03);
    });
  });

  describe('현재 기간 계산 (MONTHLY)', () => {
    const budget = {
      id: 'b1',
      userId: 'u1',
      categoryId: 'cat1',
      amount: 100000n,
      period: 'MONTHLY' as const,
      startDate: new Date('2026-01-10T00:00:00.000Z'),
    };

    beforeEach(() => {
      prisma.budget.findUnique.mockResolvedValue(budget);
    });

    it('일반적인 경우: 매달 같은 날짜로 반복된다', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-15T00:00:00.000Z'));

      const result = await service.findOne('u1', 'b1');

      expect(result.periodStart).toEqual(new Date('2026-03-10T00:00:00.000Z'));
      expect(result.periodEnd).toEqual(new Date('2026-04-10T00:00:00.000Z'));
    });

    it('말일(31일) 예산은 짧은 달에서 말일로 클램프된다', async () => {
      prisma.budget.findUnique.mockResolvedValue({
        ...budget,
        startDate: new Date('2026-01-31T00:00:00.000Z'),
      });
      jest.useFakeTimers().setSystemTime(new Date('2026-02-15T00:00:00.000Z'));

      const result = await service.findOne('u1', 'b1');

      // 2월엔 31일이 없으므로 1/31 기간은 2/28까지로 클램프된다.
      expect(result.periodStart).toEqual(new Date('2026-01-31T00:00:00.000Z'));
      expect(result.periodEnd).toEqual(new Date('2026-02-28T00:00:00.000Z'));
    });

    it('클램프된 달을 지나면 원래 날짜(31일)로 되돌아온다', async () => {
      prisma.budget.findUnique.mockResolvedValue({
        ...budget,
        startDate: new Date('2026-01-31T00:00:00.000Z'),
      });
      jest.useFakeTimers().setSystemTime(new Date('2026-03-05T00:00:00.000Z'));

      const result = await service.findOne('u1', 'b1');

      expect(result.periodStart).toEqual(new Date('2026-02-28T00:00:00.000Z'));
      expect(result.periodEnd).toEqual(new Date('2026-03-31T00:00:00.000Z'));
    });
  });

  describe('현재 기간 계산 (WEEKLY)', () => {
    it('startDate로부터 7일 단위로 반복된다', async () => {
      prisma.budget.findUnique.mockResolvedValue({
        id: 'b1',
        userId: 'u1',
        categoryId: 'cat1',
        amount: 100000n,
        period: 'WEEKLY',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
      });
      jest.useFakeTimers().setSystemTime(new Date('2026-01-20T00:00:00.000Z'));

      const result = await service.findOne('u1', 'b1');

      expect(result.periodStart).toEqual(new Date('2026-01-15T00:00:00.000Z'));
      expect(result.periodEnd).toEqual(new Date('2026-01-22T00:00:00.000Z'));
    });
  });
});
