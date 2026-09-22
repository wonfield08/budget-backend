import { AccountType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateAccountDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEnum(AccountType)
  type: AccountType;

  @IsOptional()
  @IsInt()
  balance?: number;

  @IsOptional()
  @IsString()
  currency?: string;
}
