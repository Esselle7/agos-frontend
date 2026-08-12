import { Component } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { PlComparativoComponent } from './pl-comparativo.component';
import { QuadraturaPanelComponent } from '../import/quadratura-panel.component';

@Component({
  selector: 'app-reporting',
  standalone: true,
  imports: [
    MatTabsModule,
    PlComparativoComponent,
    QuadraturaPanelComponent,
  ],
  templateUrl: './reporting.component.html',
  styleUrls: ['./reporting.component.scss'],
})
export class ReportingComponent {}
