import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Category } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

type CategoryNode = Category & { children: CategoryNode[] };

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateCategoryDto) {
    if (dto.parentId) {
      await this.assertValidParent(userId, dto.parentId, dto.type);
    }

    return this.prisma.category.create({
      data: {
        userId,
        name: dto.name,
        type: dto.type,
        parentId: dto.parentId ?? null,
        icon: dto.icon,
        color: dto.color,
      },
    });
  }

  async findAll(userId: string): Promise<CategoryNode[]> {
    const categories = await this.prisma.category.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
    return this.buildTree(categories);
  }

  async findOne(userId: string, id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException('카테고리를 찾을 수 없습니다.');
    }
    if (category.userId !== userId) {
      throw new ForbiddenException('접근 권한이 없습니다.');
    }
    return category;
  }

  async update(userId: string, id: string, dto: UpdateCategoryDto) {
    const category = await this.findOne(userId, id);

    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === id) {
        throw new BadRequestException(
          '자기 자신을 상위 카테고리로 지정할 수 없습니다.',
        );
      }
      await this.assertValidParent(userId, dto.parentId, dto.type ?? category.type);
      await this.assertNoCycle(id, dto.parentId);
    }

    return this.prisma.category.update({
      where: { id },
      data: dto,
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    await this.prisma.category.delete({ where: { id } });
    return { id };
  }

  private async assertValidParent(userId: string, parentId: string, type: string) {
    const parent = await this.prisma.category.findUnique({ where: { id: parentId } });
    if (!parent || parent.userId !== userId) {
      throw new NotFoundException('상위 카테고리를 찾을 수 없습니다.');
    }
    if (parent.type !== type) {
      throw new BadRequestException(
        '상위 카테고리와 타입(수입/지출)이 일치해야 합니다.',
      );
    }
  }

  private async assertNoCycle(id: string, newParentId: string) {
    let currentId: string | null = newParentId;
    while (currentId) {
      if (currentId === id) {
        throw new BadRequestException(
          '순환 참조가 발생하는 상위 카테고리는 지정할 수 없습니다.',
        );
      }
      const current: { parentId: string | null } | null =
        await this.prisma.category.findUnique({
          where: { id: currentId },
          select: { parentId: true },
        });
      currentId = current?.parentId ?? null;
    }
  }

  private buildTree(categories: Category[]): CategoryNode[] {
    const map = new Map<string, CategoryNode>();
    categories.forEach((category) => map.set(category.id, { ...category, children: [] }));

    const roots: CategoryNode[] = [];
    map.forEach((category) => {
      if (category.parentId && map.has(category.parentId)) {
        map.get(category.parentId)!.children.push(category);
      } else {
        roots.push(category);
      }
    });

    return roots;
  }
}
