import { TransactionType } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
} from 'class-validator';

// categoryId/transferAccountId는 null을 보내면 명시적으로 값을 비울 수 있다
// (IsOptional은 null/undefined 모두 검증을 건너뛴다).
export class UpdateTransactionDto {
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @IsOptional()
  @IsString()
  transferAccountId?: string | null;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  memo?: string;

  @IsOptional()
  @IsBoolean()
  isAuto?: boolean;

  @IsOptional()
  @IsString()
  source?: string;
}
