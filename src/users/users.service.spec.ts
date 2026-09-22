import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { createPrismaMock, asPrismaService, MockPrismaService } from '../test/prisma-mock';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new UsersService(asPrismaService(prisma));
  });

  it('존재하지 않는 사용자를 조회하면 NotFoundException을 던진다', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
  });

  it('존재하는 사용자를 반환한다', async () => {
    const user = { id: 'u1', email: 'a@a.com', createdAt: new Date() };
    prisma.user.findUnique.mockResolvedValue(user);

    const result = await service.findById('u1');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { id: true, email: true, createdAt: true },
    });
    expect(result).toBe(user);
  });
});
