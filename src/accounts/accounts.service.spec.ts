import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { createPrismaMock, asPrismaService, MockPrismaService } from '../test/prisma-mock';

describe('AccountsService', () => {
  let service: AccountsService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new AccountsService(asPrismaService(prisma));
  });

  describe('create', () => {
    it('balance 기본값 0과 currency 기본값 KRW로 생성한다', async () => {
      prisma.account.create.mockResolvedValue({ id: 'acc1' });

      await service.create('u1', { name: '지갑', type: 'CASH' as any });

      expect(prisma.account.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          name: '지갑',
          type: 'CASH',
          balance: 0n,
          currency: 'KRW',
        },
      });
    });

    it('balance/currency를 지정하면 그대로 사용한다', async () => {
      prisma.account.create.mockResolvedValue({ id: 'acc1' });

      await service.create('u1', {
        name: '달러통장',
        type: 'BANK' as any,
        balance: 10000,
        currency: 'USD',
      });

      expect(prisma.account.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          name: '달러통장',
          type: 'BANK',
          balance: 10000n,
          currency: 'USD',
        },
      });
    });
  });

  describe('findOne', () => {
    it('존재하지 않으면 NotFoundException', async () => {
      prisma.account.findUnique.mockResolvedValue(null);

      await expect(service.findOne('u1', 'acc1')).rejects.toThrow(NotFoundException);
    });

    it('다른 사용자 소유면 ForbiddenException', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'acc1', userId: 'other' });

      await expect(service.findOne('u1', 'acc1')).rejects.toThrow(ForbiddenException);
    });

    it('본인 소유면 계좌를 반환한다', async () => {
      const account = { id: 'acc1', userId: 'u1' };
      prisma.account.findUnique.mockResolvedValue(account);

      await expect(service.findOne('u1', 'acc1')).resolves.toBe(account);
    });
  });

  describe('update', () => {
    it('소유자가 아니면 수정할 수 없다', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'acc1', userId: 'other' });

      await expect(
        service.update('u1', 'acc1', { name: '변경' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.account.update).not.toHaveBeenCalled();
    });

    it('본인 소유 계좌를 수정한다', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'acc1', userId: 'u1' });
      prisma.account.update.mockResolvedValue({ id: 'acc1', name: '변경' });

      const result = await service.update('u1', 'acc1', { name: '변경' });

      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 'acc1' },
        data: { name: '변경' },
      });
      expect(result).toEqual({ id: 'acc1', name: '변경' });
    });
  });

  describe('remove', () => {
    it('본인 소유 계좌를 삭제한다', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'acc1', userId: 'u1' });

      const result = await service.remove('u1', 'acc1');

      expect(prisma.account.delete).toHaveBeenCalledWith({ where: { id: 'acc1' } });
      expect(result).toEqual({ id: 'acc1' });
    });
  });
});
