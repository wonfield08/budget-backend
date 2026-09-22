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

export class CreateTransactionDto {
  @IsString()
  accountId: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsString()
  @MinLength(1)
  title: string;

  @IsInt()
  @IsPositive()
  amount: number;

  @IsEnum(TransactionType)
  type: TransactionType;

  @IsOptional()
  @IsString()
  transferAccountId?: string;

  @IsDateString()
  date: string;

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
