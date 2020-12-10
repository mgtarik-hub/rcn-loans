import { Component, OnInit, OnChanges, OnDestroy, Input } from '@angular/core';
import { Subscription } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Engine } from '../../models/loan.model';
import { Utils } from '../../utils/utils';
import { Web3Service } from '../../services/web3.service';
import { EventsService } from '../../services/events.service';
import { ContractsService } from '../../services/contracts.service';
import { Tx, Type, TxService } from '../../services/tx.service';

@Component({
  selector: 'app-component-balance',
  templateUrl: './balance.component.html',
  styleUrls: ['./balance.component.scss']
})
export class BalanceComponent implements OnInit, OnChanges, OnDestroy {
  @Input() account: string;

  usdcAvailable: number;
  usdcLoansWithBalance: number[] = [];
  usdcOngoingWithdraw: Tx;
  usdcCanWithdraw = false;
  usdcDisplayAvailable = '';
  usdcTxSubscription: boolean;

  // subscriptions
  subscriptionBalance: Subscription;

  constructor(
    private web3Service: Web3Service,
    private eventsService: EventsService,
    private contractService: ContractsService,
    private txService: TxService
  ) { }

  ngOnInit() {
    this.retrievePendingTx();
    this.handleBalanceEvents();
  }

  ngOnChanges(changes) {
    const web3: any = this.web3Service.web3;
    const { account } = changes;

    if (account.currentValue) {
      this.account = web3.utils.toChecksumAddress(account.currentValue);
      this.loadWithdrawBalance();
    }
  }

  ngOnDestroy() {
    if (this.subscriptionBalance) {
      this.subscriptionBalance.unsubscribe();
    }
    if (this.usdcTxSubscription) {
      this.txService.unsubscribeConfirmedTx(async (tx: Tx) => this.trackWithdrawTx(tx));
    }
  }

  /**
   * Listen and handle balance events for update amounts
   */
  handleBalanceEvents() {
    this.subscriptionBalance = this.web3Service.updateBalanceEvent.subscribe(() => {
      this.loadWithdrawBalance();
    });
  }

  /**
   * Update balance and withdraw amount
   */
  updateDisplay() {
    if (this.usdcAvailable) {
      this.usdcDisplayAvailable = Utils.formatAmount(this.usdcAvailable);
    } else {
      this.usdcDisplayAvailable = '0';
    }

    this.usdcCanWithdraw =
      this.usdcLoansWithBalance !== undefined &&
      this.usdcLoansWithBalance.length > 0 &&
      this.usdcOngoingWithdraw === undefined;
  }

  /**
   * Load balance to withdraw amounts. Then, add all the values ​​and show the
   * total available
   */
  async loadWithdrawBalance() {
    const pendingWithdraws = await this.contractService.getPendingWithdraws(Engine.UsdcEngine);
    this.usdcAvailable = pendingWithdraws[2] / 10 ** 6;
    this.usdcLoansWithBalance = pendingWithdraws[3];
    this.loadOngoingWithdraw();
    this.updateDisplay();
  }

  /**
   * Load the pending withdraw
   */
  loadOngoingWithdraw() {
    this.usdcOngoingWithdraw = this.txService.getLastWithdraw(
      environment.contracts[Engine.UsdcEngine].diaspore.debtEngine,
      this.usdcLoansWithBalance
    );
  }

  /**
   * Handle click on withdraw USDC
   */
  async clickWithdrawUsdc() {
    try {
      await this.withdrawUsdc();
    } catch (err) {
      if (err.stack.indexOf('User denied transaction signature') < 0) {
        this.eventsService.trackError(err);
      }
    }
  }

  /**
   * Withdraw diaspore funds
   */
  private async withdrawUsdc() {
    if (this.usdcCanWithdraw) {
      if (this.usdcLoansWithBalance.length > 0) {
        const tx = await this.contractService.withdrawFundsDiaspore(Engine.UsdcEngine, this.usdcLoansWithBalance);
        this.txService.registerWithdrawTx(tx, environment.contracts[Engine.UsdcEngine].diaspore.debtEngine, this.usdcLoansWithBalance);
      }
      this.loadWithdrawBalance();
      this.retrievePendingTx();
    }
  }

  /**
   * Retrieve pending Tx
   */
  private retrievePendingTx() {
    if (!this.usdcTxSubscription) {
      this.usdcTxSubscription = true;
      this.txService.subscribeConfirmedTx(async (tx: Tx) => this.trackWithdrawTx(tx));
    }
  }

  /**
   * Track tx
   */
  private trackWithdrawTx(tx: Tx) {
    if (tx.type === Type.withdraw) {
      this.web3Service.updateBalanceEvent.emit();
    }
  }
}
