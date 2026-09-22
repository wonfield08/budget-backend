import { AccountType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

// balance는 거래(transaction) 생성/수정을 통해서만 바뀌어야 하므로
// 계좌 수정 DTO에는 balance 필드를 넣지 않는다.
export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;

  @IsOptional()
  @IsString()
  currency?: string;
}
