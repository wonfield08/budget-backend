import { BadRequestException } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { createPrismaMock, asPrismaService, MockPrismaService } from '../test/prisma-mock';

function makeFile(content: string, name = 'import.csv'): Express.Multer.File {
  const buffer = Buffer.from(content, 'utf-8');
  return {
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype: 'text/csv',
    size: buffer.length,
    buffer,
  } as unknown as Express.Multer.File;
}

describe('UploadsService', () => {
  let service: UploadsService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new UploadsService(asPrismaService(prisma));
  });

  describe('create - CSV 파싱', () => {
    beforeEach(() => {
      prisma.category.findMany.mockResolvedValue([
        { id: 'catCafe', userId: 'u1', name: '카페', type: 'EXPENSE' },
        { id: 'catSalary', userId: 'u1', name: '급여', type: 'INCOME' },
      ]);
      prisma.uploadBatch.create.mockResolvedValue({ id: 'batch1', userId: 'u1' });
      prisma.uploadBatch.findUnique.mockResolvedValue({
        id: 'batch1',
        userId: 'u1',
        status: 'PENDING',
      });
      prisma.uploadRow.findMany.mockResolvedValue([]);
    });

    it('정상 CSV를 파싱해서 배치와 행을 생성하고, 카테고리를 이름으로 매칭한다', async () => {
      const csv = [
        'date,type,amount,memo,category',
        '2026-01-05,EXPENSE,15000,커피,카페',
        '2026-01-06,INCOME,500000,,급여',
      ].join('\n');

      await service.create('u1', makeFile(csv));

      expect(prisma.uploadBatch.create).toHaveBeenCalledWith({
        data: { userId: 'u1', filename: 'import.csv', rowCount: 2, status: 'PENDING' },
      });
      expect(prisma.uploadRow.createMany).toHaveBeenCalledWith({
        data: [
          {
            batchId: 'batch1',
            rowIndex: 0,
            date: new Date('2026-01-05'),
            type: 'EXPENSE',
            amount: 15000n,
            memo: '커피',
            categoryName: '카페',
            categoryId: 'catCafe',
          },
          {
            batchId: 'batch1',
            rowIndex: 1,
            date: new Date('2026-01-06'),
            type: 'INCOME',
            amount: 500000n,
            memo: null,
            categoryName: '급여',
            categoryId: 'catSalary',
          },
        ],
      });
    });

    it('필수 컬럼이 없으면 BadRequestException', async () => {
      const csv = ['date,type,memo', '2026-01-05,EXPENSE,커피'].join('\n');

      await expect(service.create('u1', makeFile(csv))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('날짜 형식이 잘못되면 BadRequestException', async () => {
      const csv = ['date,type,amount', 'not-a-date,EXPENSE,1000'].join('\n');

      await expect(service.create('u1', makeFile(csv))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('type이 INCOME/EXPENSE가 아니면 BadRequestException', async () => {
      const csv = ['date,type,amount', '2026-01-05,TRANSFER,1000'].join('\n');

      await expect(service.create('u1', makeFile(csv))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('amount가 0 이하이거나 정수가 아니면 BadRequestException', async () => {
      const csv = ['date,type,amount', '2026-01-05,EXPENSE,abc'].join('\n');

      await expect(service.create('u1', makeFile(csv))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('파일 크기가 5MB를 넘으면 BadRequestException', async () => {
      const file = makeFile('date,type,amount\n2026-01-05,EXPENSE,1000');
      (file as any).size = 6 * 1024 * 1024;

      await expect(service.create('u1', file)).rejects.toThrow(BadRequestException);
    });
  });

  describe('confirm', () => {
    it('PENDING이 아니면 BadRequestException', async () => {
      prisma.uploadBatch.findUnique.mockResolvedValue({
        id: 'batch1',
        userId: 'u1',
        status: 'CONFIRMED',
      });

      await expect(
        service.confirm('u1', 'batch1', { accountId: 'acc1' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('행들을 거래로 일괄 생성하고 계좌 잔액을 반영한 뒤 CONFIRMED로 바꾼다', async () => {
      prisma.uploadBatch.findUnique.mockResolvedValue({
        id: 'batch1',
        userId: 'u1',
        status: 'PENDING',
        filename: 'import.csv',
      });
      prisma.account.findUnique.mockResolvedValue({ id: 'acc1', userId: 'u1' });
      prisma.uploadRow.findMany.mockResolvedValue([
        {
          id: 'r1',
          batchId: 'batch1',
          rowIndex: 0,
          date: new Date('2026-01-05'),
          type: 'EXPENSE',
          amount: 1000n,
          memo: null,
          categoryId: null,
        },
        {
          id: 'r2',
          batchId: 'batch1',
          rowIndex: 1,
          date: new Date('2026-01-06'),
          type: 'INCOME',
          amount: 2000n,
          memo: null,
          categoryId: null,
        },
      ]);
      prisma.transaction.create
        .mockResolvedValueOnce({ id: 't1' })
        .mockResolvedValueOnce({ id: 't2' });

      await service.confirm('u1', 'batch1', { accountId: 'acc1' });

      expect(prisma.transaction.create).toHaveBeenCalledTimes(2);
      expect(prisma.uploadRow.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { transactionId: 't1' },
      });
      // -1000(EXPENSE) + 2000(INCOME) = +1000
      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 'acc1' },
        data: { balance: { increment: 1000n } },
      });
      expect(prisma.uploadBatch.update).toHaveBeenCalledWith({
        where: { id: 'batch1' },
        data: { status: 'CONFIRMED' },
      });
    });
  });

  describe('cancel', () => {
    it('PENDING이 아니면 BadRequestException', async () => {
      prisma.uploadBatch.findUnique.mockResolvedValue({
        id: 'batch1',
        userId: 'u1',
        status: 'CANCELLED',
      });

      await expect(service.cancel('u1', 'batch1')).rejects.toThrow(BadRequestException);
    });

    it('PENDING이면 CANCELLED로 바꾼다', async () => {
      prisma.uploadBatch.findUnique.mockResolvedValue({
        id: 'batch1',
        userId: 'u1',
        status: 'PENDING',
      });
      prisma.uploadRow.findMany.mockResolvedValue([]);

      await service.cancel('u1', 'batch1');

      expect(prisma.uploadBatch.update).toHaveBeenCalledWith({
        where: { id: 'batch1' },
        data: { status: 'CANCELLED' },
      });
    });
  });
});
