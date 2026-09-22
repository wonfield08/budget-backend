import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { UploadsService } from './uploads.service';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { UpdateUploadRowDto } from './dto/update-upload-row.dto';

@UseGuards(JwtAuthGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  create(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('file 필드로 CSV 파일을 첨부해주세요.');
    }
    return this.uploadsService.create(user.userId, file);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.uploadsService.findAll(user.userId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.uploadsService.findOne(user.userId, id);
  }

  @Patch(':id/rows/:rowId')
  updateRow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('rowId') rowId: string,
    @Body() dto: UpdateUploadRowDto,
  ) {
    return this.uploadsService.updateRow(user.userId, id, rowId, dto);
  }

  @Delete(':id/rows/:rowId')
  removeRow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('rowId') rowId: string,
  ) {
    return this.uploadsService.removeRow(user.userId, id, rowId);
  }

  @Post(':id/confirm')
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ConfirmUploadDto,
  ) {
    return this.uploadsService.confirm(user.userId, id, dto);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.uploadsService.cancel(user.userId, id);
  }
}
