import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TransactionType, UploadBatch } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';

interface ParsedRow {
  rowIndex: number;
  date: Date;
  type: TransactionType;
  amount: bigint;
  memo: string | null;
  categoryName: string | null;
  categoryId: string | null;
}

const REQUIRED_COLUMNS = ['date', 'type', 'amount'];
const MAX_FILE_SIZE = 5 * 1024 * 1024;

@Injectable()
export class UploadsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('업로드할 파일이 없습니다.');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('파일 크기는 5MB를 넘을 수 없습니다.');
    }

    const content = file.buffer.toString('utf-8');
    const rows = await this.parseRows(userId, content);
    if (rows.length === 0) {
      throw new BadRequestException('가져올 행이 없습니다.');
    }

    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.uploadBatch.create({
        data: {
          userId,
          filename: file.originalname,
          rowCount: rows.length,
          status: 'PENDING',
        },
      });

      await tx.uploadRow.createMany({
        data: rows.map((row) => ({
          batchId: created.id,
          rowIndex: row.rowIndex,
          date: row.date,
          type: row.type,
          amount: row.amount,
          memo: row.memo,
          categoryName: row.categoryName,
          categoryId: row.categoryId,
        })),
      });

      return created;
    });

    return this.findOne(userId, batch.id);
  }

  findAll(userId: string) {
    return this.prisma.uploadBatch.findMany({
      where: { userId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async findOne(userId: string, id: string) {
    const batch = await this.getOwned(userId, id);
    const rows = await this.prisma.uploadRow.findMany({
      where: { batchId: id },
      orderBy: { rowIndex: 'asc' },
    });
    return { ...batch, rows };
  }

  async confirm(userId: string, id: string, dto: ConfirmUploadDto) {
    const batch = await this.getOwned(userId, id);
    if (batch.status !== 'PENDING') {
      throw new BadRequestException('대기(PENDING) 상태인 업로드만 확정할 수 있습니다.');
    }

    const account = await this.prisma.account.findUnique({
      where: { id: dto.accountId },
    });
    if (!account || account.userId !== userId) {
      throw new NotFoundException('계좌를 찾을 수 없습니다.');
    }

    const rows = await this.prisma.uploadRow.findMany({
      where: { batchId: id },
      orderBy: { rowIndex: 'asc' },
    });

    await this.prisma.$transaction(async (tx) => {
      let balanceDelta = 0n;

      for (const row of rows) {
        const transaction = await tx.transaction.create({
          data: {
            userId,
            accountId: dto.accountId,
            categoryId: row.categoryId,
            title: row.memo || row.categoryName || '명세서 항목',
            amount: row.amount,
            type: row.type,
            date: row.date,
            memo: row.memo,
            isAuto: true,
            source: batch.filename,
          },
        });

        await tx.uploadRow.update({
          where: { id: row.id },
          data: { transactionId: transaction.id },
        });

        balanceDelta += row.type === 'INCOME' ? row.amount : -row.amount;
      }

      await tx.account.update({
        where: { id: dto.accountId },
        data: { balance: { increment: balanceDelta } },
      });

      await tx.uploadBatch.update({ where: { id }, data: { status: 'CONFIRMED' } });
    });

    return this.findOne(userId, id);
  }

  async cancel(userId: string, id: string) {
    const batch = await this.getOwned(userId, id);
    if (batch.status !== 'PENDING') {
      throw new BadRequestException('대기(PENDING) 상태인 업로드만 취소할 수 있습니다.');
    }
    await this.prisma.uploadBatch.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    return this.findOne(userId, id);
  }

  private async getOwned(userId: string, id: string): Promise<UploadBatch> {
    const batch = await this.prisma.uploadBatch.findUnique({ where: { id } });
    if (!batch) {
      throw new NotFoundException('업로드 내역을 찾을 수 없습니다.');
    }
    if (batch.userId !== userId) {
      throw new ForbiddenException('접근 권한이 없습니다.');
    }
    return batch;
  }

  // CSV 헤더: date,type,amount,memo(옵션),category(옵션)
  // category는 사용자의 기존 카테고리 이름과 대소문자 무시하고 매칭되면 연결하고,
  // 매칭되지 않으면 이름만 기록해두고 categoryId는 null로 둔다.
  private async parseRows(userId: string, content: string): Promise<ParsedRow[]> {
    const lines = this.parseCsv(content);
    const [header, ...dataLines] = lines;
    if (!header) {
      throw new BadRequestException('빈 파일입니다.');
    }

    const columns = header.map((h) => h.trim().toLowerCase());
    for (const required of REQUIRED_COLUMNS) {
      if (!columns.includes(required)) {
        throw new BadRequestException(`필수 컬럼이 없습니다: ${required}`);
      }
    }

    const idx = {
      date: columns.indexOf('date'),
      type: columns.indexOf('type'),
      amount: columns.indexOf('amount'),
      memo: columns.indexOf('memo'),
      category: columns.indexOf('category'),
    };

    const categories = await this.prisma.category.findMany({ where: { userId } });
    const categoryLookup = new Map(
      categories.map((category) => [
        `${category.type}:${category.name.toLowerCase()}`,
        category.id,
      ]),
    );

    return dataLines.map((cols, index) => {
      const rowNumber = index + 2; // 1행은 헤더
      const rawDate = cols[idx.date];
      const rawType = cols[idx.type]?.toUpperCase();
      const rawAmount = cols[idx.amount];

      const date = new Date(rawDate);
      if (!rawDate || Number.isNaN(date.getTime())) {
        throw new BadRequestException(
          `${rowNumber}행: 날짜 형식이 올바르지 않습니다 (${rawDate}).`,
        );
      }
      if (rawType !== 'INCOME' && rawType !== 'EXPENSE') {
        throw new BadRequestException(
          `${rowNumber}행: type은 INCOME 또는 EXPENSE여야 합니다 (${rawType}).`,
        );
      }
      const amount = Number(rawAmount);
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new BadRequestException(
          `${rowNumber}행: amount는 0보다 큰 정수여야 합니다 (${rawAmount}).`,
        );
      }

      const memo = idx.memo >= 0 ? cols[idx.memo] || null : null;
      const categoryName = idx.category >= 0 ? cols[idx.category] || null : null;
      const categoryId = categoryName
        ? (categoryLookup.get(`${rawType}:${categoryName.toLowerCase()}`) ?? null)
        : null;

      return {
        rowIndex: index,
        date,
        type: rawType as TransactionType,
        amount: BigInt(amount),
        memo,
        categoryName,
        categoryId,
      };
    });
  }

  private parseCsv(content: string): string[][] {
    return content
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => this.parseCsvLine(line));
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"') {
          if (line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result.map((value) => value.trim());
  }
}
