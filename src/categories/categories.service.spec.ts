import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { createPrismaMock, asPrismaService, MockPrismaService } from '../test/prisma-mock';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new CategoriesService(asPrismaService(prisma));
  });

  describe('create', () => {
    it('parentId 없이 생성한다', async () => {
      prisma.category.create.mockResolvedValue({ id: 'c1' });

      await service.create('u1', { name: '식비', type: 'EXPENSE' as any });

      expect(prisma.category.findUnique).not.toHaveBeenCalled();
      expect(prisma.category.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          name: '식비',
          type: 'EXPENSE',
          parentId: null,
          icon: undefined,
          color: undefined,
        },
      });
    });

    it('상위 카테고리가 없으면 NotFoundException', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.create('u1', { name: '외식', type: 'EXPENSE' as any, parentId: 'missing' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('상위 카테고리와 타입이 다르면 BadRequestException', async () => {
      prisma.category.findUnique.mockResolvedValue({
        id: 'parent',
        userId: 'u1',
        type: 'INCOME',
      });

      await expect(
        service.create('u1', { name: '외식', type: 'EXPENSE' as any, parentId: 'parent' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('자기 자신을 parentId로 지정하면 BadRequestException', async () => {
      prisma.category.findUnique.mockResolvedValue({
        id: 'c1',
        userId: 'u1',
        type: 'EXPENSE',
      });

      await expect(
        service.update('u1', 'c1', { parentId: 'c1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('순환 참조가 생기면 BadRequestException', async () => {
      // c1(자신) -> parent로 바꾸려는 대상 c2, c2.parentId가 c1이면 순환.
      const categoriesById: Record<string, any> = {
        c1: { id: 'c1', userId: 'u1', type: 'EXPENSE', parentId: null },
        c2: { id: 'c2', userId: 'u1', type: 'EXPENSE', parentId: 'c1' },
      };

      prisma.category.findUnique.mockImplementation(({ where: { id } }: any) => {
        if (id === 'c1') return Promise.resolve(categoriesById.c1);
        if (id === 'c2') {
          const record = categoriesById.c2;
          return Promise.resolve(record);
        }
        return Promise.resolve(null);
      });

      await expect(
        service.update('u1', 'c1', { parentId: 'c2' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('유효한 상위 카테고리로 변경한다', async () => {
      const categoriesById: Record<string, any> = {
        c1: { id: 'c1', userId: 'u1', type: 'EXPENSE', parentId: null },
        c2: { id: 'c2', userId: 'u1', type: 'EXPENSE', parentId: null },
      };
      prisma.category.findUnique.mockImplementation(({ where: { id } }: any) =>
        Promise.resolve(categoriesById[id] ?? null),
      );
      prisma.category.update.mockResolvedValue({ id: 'c1', parentId: 'c2' });

      const result = await service.update('u1', 'c1', { parentId: 'c2' });

      expect(prisma.category.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { parentId: 'c2' },
      });
      expect(result).toEqual({ id: 'c1', parentId: 'c2' });
    });
  });

  describe('findAll', () => {
    it('parentId 기준으로 트리를 만든다', async () => {
      prisma.category.findMany.mockResolvedValue([
        { id: 'root', userId: 'u1', name: '식비', parentId: null },
        { id: 'child', userId: 'u1', name: '외식', parentId: 'root' },
        { id: 'grandchild', userId: 'u1', name: '커피', parentId: 'child' },
      ]);

      const tree = await service.findAll('u1');

      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe('root');
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].id).toBe('child');
      expect(tree[0].children[0].children[0].id).toBe('grandchild');
    });
  });
});
