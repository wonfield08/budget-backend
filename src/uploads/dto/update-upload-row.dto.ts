import { IsOptional, IsString } from 'class-validator';

export class UpdateUploadRowDto {
  @IsOptional()
  @IsString()
  categoryId?: string | null;
}
