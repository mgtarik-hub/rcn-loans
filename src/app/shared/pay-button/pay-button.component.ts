import { Component, OnInit, Input } from '@angular/core';
import {
  MatDialog,
  MatDialogRef,
  MatSnackBar,
  MAT_DIALOG_DATA,
  MatSnackBarHorizontalPosition,
} from '@angular/material';
// App Services
import { environment } from '../../../environments/environment';
import { TxService, Tx } from '../../tx.service';
import { ContractsService } from '../../services/contracts.service';
import { Loan } from '../../models/loan.model';
import { Currency } from '../../utils/currencies';
import { EventsService, Category } from '../../services/events.service';
import { Web3Service } from '../../services/web3.service';
import { CountriesService } from '../../services/countries.service';
import { CivicService } from '../../services/civic.service';
import { CivicAuthComponent } from '../civic-auth/civic-auth.component';
import { DialogLoanPayComponent } from '../../dialogs/dialog-loan-pay/dialog-loan-pay.component';
import { DialogClientAccountComponent } from '../../dialogs/dialog-client-account/dialog-client-account.component';
import { DialogGenericErrorComponent } from '../../dialogs/dialog-generic-error/dialog-generic-error.component';
import { DialogInsufficientFoundsComponent } from '../../dialogs/dialog-insufficient-founds/dialog-insufficient-founds.component';
import { DialogApproveContractComponent } from '../../dialogs/dialog-approve-contract/dialog-approve-contract.component';



@Component({
  selector: 'app-pay-button',
  templateUrl: './pay-button.component.html',
  styleUrls: ['./pay-button.component.scss']
})
export class PayButtonComponent implements OnInit {

	@Input() loan: Loan;
  @Input() isOngoing: boolean;
  account: string;
	pendingTx: Tx = undefined;
  horizontalPosition: MatSnackBarHorizontalPosition = 'center';
  opPending = false;
  lendEnabled: Boolean;
  
  constructor(
    private contractsService: ContractsService,
    private txService: TxService,
    private eventsService: EventsService,
    private web3Service: Web3Service,
    public snackBar: MatSnackBar,
    private civicService: CivicService,
    private countriesService: CountriesService,
    public dialog: MatDialog	
  ) {}

  handlePay() {}

  async loadPay(forze = false) {
    if (this.opPending && !forze) { return; }

    try {
      const engineApproved = await this.contractsService.isEngineApproved();
      const civicApproved = this.civicService.status();
      const balance = await this.contractsService.getUserBalanceRCNWei();
      const required = await this.contractsService.estimateRequiredAmount(this.loan);
      
      if (! engineApproved) {
        this.showApproveDialog();
        return;
      }

      if ( balance <  required) {
        this.eventsService.trackEvent(
          'show-insufficient-funds-lend',
          Category.Account,
          'loan #' + this.loan.id,
           required
        );
        this.showInsufficientFundsDialog( required,  balance);
        return;
      }

      /*if (!await civicApproved) {     
        this.showCivicDialog();
        return;
      }*/

      const dialogRef = this.dialog.open(DialogLoanPayComponent);
      dialogRef.afterClosed().subscribe(amount => {
        if(amount){ 
          amount = amount * 10 ** Currency.getDecimals("RCN");
          this.eventsService.trackEvent(
            'set-to-pay-loan',
            Category.Loan,
            'loan #' + this.loan.id + ' of ' + amount
          ); 

          this.contractsService.payLoan(this.loan, amount).then((tx) => {
            this.eventsService.trackEvent(
              'pay-loan',
              Category.Loan,
              'loan #' + this.loan.id + ' of ' + amount
            );
            this.txService.registerTransferTx(tx, environment.contracts.basaltEngine, this.loan, amount);  
            this.retrievePendingTx();
          });
        }
      });         
    } catch (e) {
      // Don't show 'User denied transaction signature' error
      if (e.message.indexOf('User denied transaction signature') < 0) {
        this.dialog.open(DialogGenericErrorComponent, {
          data: { error: e }
        });
      }
    }
  }

  showCivicDialog() {
    const dialogRef: MatDialogRef<CivicAuthComponent> = this.dialog.open(CivicAuthComponent, {
      width: '800px'
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.loadPay(true);
      } else {
        this.cancelOperation();
      }
    });
  }

 showInsufficientFundsDialog(required: number, funds: number) {
    const dialogRef = this.dialog.open(DialogInsufficientFoundsComponent, { data: {
      required: required,
      balance: funds
    }});
    this.cancelOperation();
  }

  showApproveDialog() {
    const dialogRef: MatDialogRef<DialogApproveContractComponent> = this.dialog.open(DialogApproveContractComponent);
    dialogRef.componentInstance.autoClose = true;
    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadPay(true);
      } else {
        this.cancelOperation();
      }
    });
  }

  cancelOperation() {
    console.log('Cancel Pay');
    this.openSnackBar('Your transaction has failed', '');
    this.opPending = false;
  }  

  retrievePendingTx() {
    this.pendingTx = this.txService.getLastPendingTransfer(environment.contracts.basaltEngine, this.loan);
  }

  openSnackBar(message: string, action: string) {
    this.snackBar.open(message , action, {
      duration: 4000,
      horizontalPosition: this.horizontalPosition,
    });
  }  

  clickPay() {
    if (this.pendingTx === undefined) {
      this.eventsService.trackEvent(
        'click-lend',
        Category.Loan,
        'loan #' + this.loan.id
      );

      this.loadPay();
    } else {
      window.open(environment.network.explorer.tx.replace('${tx}', this.pendingTx.tx), '_blank');
    }
  }  

  ngOnInit() {
    this.retrievePendingTx();
    this.web3Service.getAccount().then((account) => {
      this.account = account;
    });
    this.countriesService.lendEnabled().then((lendEnabled) => {
      this.lendEnabled = lendEnabled;
    });    
  }

}
