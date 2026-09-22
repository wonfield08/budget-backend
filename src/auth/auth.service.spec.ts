import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { createPrismaMock, asPrismaService, MockPrismaService } from '../test/prisma-mock';
import { DEFAULT_CATEGORIES } from '../categories/default-categories';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: MockPrismaService;
  let jwtService: { sign: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();
    jwtService = { sign: jest.fn().mockReturnValue('signed-token') };
    service = new AuthService(asPrismaService(prisma), jwtService as any);
    jest.clearAllMocks();
  });

  describe('signup', () => {
    it('이미 가입된 이메일이면 ConflictException을 던진다', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@a.com' });

      await expect(
        service.signup({ email: 'a@a.com', password: 'password123' }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('비밀번호를 해싱해서 저장하고 accessToken을 발급한다', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue({
        id: 'u1',
        email: 'a@a.com',
        passwordHash: 'hashed-password',
      });

      const result = await service.signup({
        email: 'a@a.com',
        password: 'password123',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'a@a.com', passwordHash: 'hashed-password' },
      });
      expect(jwtService.sign).toHaveBeenCalledWith({ sub: 'u1', email: 'a@a.com' });
      expect(result).toEqual({
        accessToken: 'signed-token',
        user: { id: 'u1', email: 'a@a.com' },
      });
    });

    it('가입 시 기본 카테고리를 함께 생성한다', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue({
        id: 'u1',
        email: 'a@a.com',
        passwordHash: 'hashed-password',
      });

      await service.signup({ email: 'a@a.com', password: 'password123' });

      expect(prisma.category.createMany).toHaveBeenCalledWith({
        data: DEFAULT_CATEGORIES.map((category) => ({ ...category, userId: 'u1' })),
      });
    });
  });

  describe('login', () => {
    it('존재하지 않는 이메일이면 UnauthorizedException을 던진다', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nope@a.com', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('비밀번호가 틀리면 UnauthorizedException을 던진다', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@a.com',
        passwordHash: 'hashed-password',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: 'a@a.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('이메일/비밀번호가 맞으면 accessToken을 발급한다', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@a.com',
        passwordHash: 'hashed-password',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({
        email: 'a@a.com',
        password: 'password123',
      });

      expect(bcrypt.compare).toHaveBeenCalledWith('password123', 'hashed-password');
      expect(result).toEqual({
        accessToken: 'signed-token',
        user: { id: 'u1', email: 'a@a.com' },
      });
    });
  });
});
