import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { RolesGuard } from '../auth/guards';

/** Activos fijos y depreciación. Contabiliza vía AccountingModule (hoja). */
@Module({
  imports: [AuthModule, PrismaModule, AccountingModule],
  controllers: [AssetsController],
  providers: [AssetsService, RolesGuard],
  exports: [AssetsService],
})
export class AssetsModule {}
