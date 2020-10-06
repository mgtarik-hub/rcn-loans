import { Component, OnInit, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material';
import { timer } from 'rxjs';
import * as BN from 'bn.js';
import { environment } from '../../../environments/environment';
import { Loan, Status } from '../../models/loan.model';
import { Utils } from '../../utils/utils';
import { Currency } from '../../utils/currencies';
// App services
import { ContractsService } from '../../services/contracts.service';
import { CurrenciesService, CurrencyItem } from '../../services/currencies.service';
import { Web3Service } from '../../services/web3.service';
import { EventsService } from '../../services/events.service';

@Component({
  selector: 'app-dialog-loan-lend',
  templateUrl: './dialog-loan-lend.component.html',
  styleUrls: ['./dialog-loan-lend.component.scss']
})
export class DialogLoanLendComponent implements OnInit {
  // loan
  loan: Loan;
  shortLoanId: string;
  loanAmount: string;
  loanExpectedReturn: any;
  isRequest: boolean;
  isCanceled: boolean;
  // lend
  lendAmount: string;
  lendExpectedReturn: string;
  lendCurrency: string;
  lendToken: string;
  exchangeRcn: string;
  exchangeToken: string;
  exchangeTooltips: string[];
  txCost: string;
  // general
  account: string;
  canLend: boolean;
  availableCurrencies: CurrencyItem[];
  explorerAddress: string = environment.network.explorer.address;

  loading: boolean;

  constructor(
    private contractsService: ContractsService,
    private currenciesService: CurrenciesService,
    private web3Service: Web3Service,
    private eventsService: EventsService,
    public dialogRef: MatDialogRef<any>,
    @Inject(MAT_DIALOG_DATA) data: {loan: Loan}
  ) {
    this.loan = data.loan;
  }

  async ngOnInit() {
    this.availableCurrencies = await this.currenciesService.getCurrencies(true);
    if (this.loan.isRequest) {
      this.canLend = true;
    }

    // loan currency and amounts
    const loanCurrency: Currency = this.loan.currency;
    const loanAmount: BN = Utils.bn(this.loan.amount);
    const loanExpectedReturn = Utils.bn(this.loan.descriptor.totalObligation);

    // set user account
    const account: string = await this.web3Service.getAccount();
    this.account = account;

    // set loan amount and rate
    const web3: any = this.web3Service.web3;
    const rate: BN = await this.getLoanRate();
    this.loanAmount = Utils.formatAmount(loanCurrency.fromUnit(loanAmount));
    this.loanExpectedReturn = Utils.formatAmount(loanCurrency.fromUnit(loanExpectedReturn));
    this.exchangeRcn = Utils.formatAmount(web3.utils.fromWei(rate), 4);

    // set loan status
    this.isCanceled = this.loan.status === Status.Destroyed;
    this.isRequest = this.loan.status === Status.Request;

    this.loadExchangeTooltip();
    this.shortLoanId =
      String(this.loan.id).startsWith('0x') ? Utils.shortAddress(this.loan.id) : this.loan.id;
  }

  /**
   * Calculate new amounts when the currency select is toggled
   */
  async onChangeCurrency() {
    this.exchangeToken = null;
    this.lendAmount = '0';
    this.lendExpectedReturn = '0';

    try {
      await this.calculateAmounts();
      this.loadExchangeTooltip();
      this.loadTxCost();
    } catch (e) {
      this.eventsService.trackError(e);
      throw Error('error calculating currency amounts');
    }
  }

  /**
   * Calculate the exchange token rate, lend amount and expected return
   * amount in token
   */
  async calculateAmounts() {
    const web3: any = this.web3Service.web3;
    const loan: Loan = this.loan;
    const loanAmount: BN = Utils.bn(loan.amount);
    const loanExpectedReturn: BN = Utils.bn(loan.descriptor.totalObligation);

    // set rate values
    const rcnRate: BN = await this.getLoanRate();
    const rcnAmountInWei: BN = Utils.bn(loanAmount.mul(rcnRate));
    const rcnExpectedReturnInWei: BN = Utils.bn(loanExpectedReturn.mul(rcnRate));
    const loanCurrencyDecimals: number = loan.currency.decimals;
    const rcnAmount: BN = rcnAmountInWei.div(Utils.bn(10).pow(Utils.bn(loanCurrencyDecimals)));
    const rcnExpectedReturn: BN = rcnExpectedReturnInWei.div(Utils.bn(10).pow(Utils.bn(loanCurrencyDecimals)));

    // set amount in selected currency
    const symbol: string = this.lendCurrency;
    const fromToken: string = environment.contracts.rcnToken;
    const toToken: string = await this.currenciesService.getCurrencyByKey('symbol', symbol).address;
    const lendCurrencyDecimals: number = await this.contractsService.getTokenDecimals(toToken);
    this.lendToken = toToken;

    let lendAmount: BN | string;
    // let lendExpectedReturn: number;

    if (fromToken === toToken) {
      // rcn -> rcn
      lendAmount = rcnAmount;
      // lendExpectedReturn = rcnExpectedReturn;
    } else {
      lendAmount = await this.contractsService.estimateLendAmount(loan, toToken);

      // TODO: Expected return in selected currency
      // lendExpectedReturn = await this.contractsService.getPriceConvertFrom(
      //   fromToken,
      //   toToken,
      //   rcnExpectedReturn
      // );

      // set lending currency rate
      const lendAmountInWei: BN = Utils.bn(lendAmount).mul(Utils.bn(10).pow(Utils.bn(loanCurrencyDecimals)));
      const lendOverAmount: BN = Utils.bn(lendAmountInWei).div(Utils.bn(loanAmount));
      const lendCurrencyRate: number = lendOverAmount.toString() as any / 10 ** lendCurrencyDecimals;
      this.exchangeToken = Utils.formatAmount(lendCurrencyRate, 4);
    }

    // set ui values
    this.lendAmount = Utils.formatAmount(
      lendAmount.toString() as any / 10 ** lendCurrencyDecimals
    );
    this.lendExpectedReturn = Utils.formatAmount(
      web3.utils.fromWei(rcnExpectedReturn)
    );
  }

  loadExchangeTooltip() {
    const loanCurrency: string = this.loan.currency.toString();
    const lendCurrency: string = this.lendCurrency;
    const oracle = this.loan.oracle.address;
    const tokenConverter = environment.contracts.converter.uniswapConverter;
    const urlOracle = environment.network.explorer.address.replace('${address}', oracle);
    const urlTokenConverter = environment.network.explorer.address.replace('${address}', tokenConverter);
    this.exchangeTooltips = [];

    if (!this.exchangeToken) {
      if (loanCurrency !== 'RCN') {
        this.exchangeTooltips.push(`<a href="${ urlOracle }" target="_blank">RCN/${ loanCurrency }</a> Oracle.`);
      }
      return;
    }

    if (loanCurrency !== 'RCN' && lendCurrency !== 'RCN') {
      this.exchangeTooltips.push(`<a href="${ urlOracle }" target="_blank">RCN/${ loanCurrency }</a> Oracle.`);
      this.exchangeTooltips.push(`<a href="${ urlTokenConverter }" target="_blank">RCN/${ lendCurrency }</a> Token Converter.`);
      return;
    }
    if (loanCurrency !== 'RCN') {
      this.exchangeTooltips.push(`<a href="${ urlOracle }" target="_blank">RCN/${ loanCurrency }</a> Oracle.`);
      return;
    }
    if (lendCurrency !== 'RCN') {
      this.exchangeTooltips.push(`<a href="${ urlTokenConverter }" target="_blank">RCN/${ lendCurrency }</a> Token Converter.`);
      return;
    }
  }

  async loadTxCost() {
    this.txCost = null;

    try {
      const txCost = (await this.getTxCost()) / 10 ** 18;
      const rawEthUsd = await this.contractsService.latestAnswer();
      const ethUsd = rawEthUsd / 10 ** 8;
      this.txCost = Utils.formatAmount(txCost * ethUsd) + ' USD';
    } catch (err) {
      this.txCost = 'Insufficient funds';
    }
  }

  /**
   * Get currency data by code
   * @param symbol Currency symbol
   * @return Currency data
   */
  getCurrencyByCode(symbol: string): {
    symbol: string,
    img: string,
    address: string
  } {
    const currency: Array<any> = this.availableCurrencies.filter(
      item => item.symbol === symbol
    );
    return currency[0] || null;
  }

  /**
   * Load rates and exchange values
   * @return Loan rate in wei
   */
  async getLoanRate(): Promise<BN> {
    const currency: any = this.loan.currency;
    const oracle: string = this.loan.oracle.address;
    const rate = await this.contractsService.getRate(oracle, currency.decimals);
    return rate;
  }

  /**
   * Calculate gas price * estimated gas
   * @return Tx cost
   */
  async getTxCost() {
    const {
      payableAmount,
      tokenConverter,
      lendToken,
      required,
      cosignerAddress,
      cosignerLimit,
      loanId,
      oracleData,
      cosignerData,
      callbackData,
      account
    } = await this.contractsService.getLendParams(this.loan, this.lendToken);
    const gasPrice = await this.web3Service.web3.eth.getGasPrice();
    const estimatedGas = await this.contractsService.converterRampLend(
      payableAmount,
      tokenConverter,
      lendToken,
      required,
      cosignerAddress,
      cosignerLimit,
      loanId,
      oracleData,
      cosignerData,
      callbackData,
      account,
      true
    );
    const gasLimit = Number(estimatedGas) * 110 / 100;
    const txCost = gasLimit * gasPrice;
    return txCost;
  }

  /**
   * Method called when the transaction was completed
   */
  async endLend() {
    await timer(1000).toPromise();
    this.dialogRef.close(true);
  }

  /**
   * Close dialog
   */
  closeDialog() {
    this.dialogRef.close();
  }
}
