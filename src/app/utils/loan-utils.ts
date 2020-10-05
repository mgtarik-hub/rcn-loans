import { Loan, Oracle, Descriptor, Debt, Config, Status, Model } from '../models/loan.model';
import { Collateral } from '../models/collateral.model';
import { LoanApiDiaspore } from './../interfaces/loan-api-diaspore';
import { Utils } from './utils';
import { environment, Agent } from './../../environments/environment';

interface ModelDebtInfo {
  paid: number;
  due_time: number;
  estimated_obligation: number;
  next_obligation: number;
  current_obligation: number;
  debt_balance: number;
  owner: string;
}

interface ModelConfig {
  installments: number;
  time_unit: number;
  duration: number;
  lent_time: number;
  cuota: number;
  interest_rate: number;
}

export class LoanUtils {
  static decodeInterest(raw: number): number {
    return 311040000000000 / raw;
  }
  static calculateInterest(_timeDelta: number, _interestRate: number, _amount: number): number {
    return (_amount * 100000 * _timeDelta) / _interestRate;
  }

  /**
   * Get the cosigner address (and expected address for loans in request status)
   * @param loan Loan
   * @return Cosigner address
   */
  static getCosignerAddress(loan: Loan) {
    const creator: Agent = environment.dir[loan.creator.toLowerCase()];
    const cosignerAddress: string = loan.isRequest ? environment.cosigners[creator] : loan.cosigner;
    return cosignerAddress;
  }

  /**
   * Create diaspore loan model from the api response
   * @param loanData Loan data obtained from API
   * @return Loan
   */
  static createDiasporeLoan(
    loanData: LoanApiDiaspore,
    debtInfo: ModelDebtInfo,
    modelConfig: ModelConfig
  ): Loan {
    const engine = environment.contracts.diaspore.loanManager;

    let oracle: Oracle;
    if (loanData.oracle !== Utils.address0x) {
      const currency = loanData.currency ? Utils.hexToAscii(loanData.currency.replace(/^[0x]+|[0]+$/g, '')) : '';
      oracle = new Oracle(
        loanData.oracle,
        currency,
        loanData.currency
      );
    } else {
      oracle = new Oracle(
        loanData.oracle,
        'RCN',
        loanData.currency
      );
    }

    let descriptor: Descriptor;
    let debt: Debt;
    let config: Config;

    descriptor = new Descriptor(
      Number(loanData.descriptor.first_obligation),
      loanData.descriptor.total_obligation,
      Number(loanData.descriptor.duration),
      Number(loanData.descriptor.interest_rate),
      LoanUtils.decodeInterest(
        Number(loanData.descriptor.punitive_interest_rate)
      ),
      Number(loanData.descriptor.frequency),
      Number(loanData.descriptor.installments)
    );

    // set debt model
    if (debtInfo) {
      const paid = debtInfo.paid;
      const dueTime = debtInfo.due_time;
      const estimatedObligation = debtInfo.estimated_obligation;
      const nextObligation = debtInfo.next_obligation;
      const currentObligation = debtInfo.current_obligation;
      const debtBalance = debtInfo.debt_balance;
      const owner = debtInfo.owner;
      debt = new Debt(
        loanData.id,
        new Model(
          loanData.model,
          paid,
          nextObligation,
          currentObligation,
          estimatedObligation,
          dueTime
        ),
        debtBalance,
        engine,
        owner,
        oracle
      );
    }
    const status = loanData.canceled ? Status.Destroyed : Number(loanData.status);

    if (modelConfig) {
      config = new Config(
        Number(modelConfig.installments),
        Number(modelConfig.time_unit),
        Number(modelConfig.duration),
        Number(modelConfig.lent_time),
        Number(modelConfig.cuota),
        Number(modelConfig.interest_rate)
      );
    }

    const { collaterals } = loanData;
    let collateral: Collateral;
    if (collaterals && collaterals.length) {
      const {
        id,
        debt_id,
        oracle: collateralOracle,
        token,
        amount,
        liquidation_ratio,
        balance_ratio,
        status: collateralStatus
      } = collaterals[0];

      collateral = new Collateral(
        Number(id),
        debt_id,
        collateralOracle,
        token,
        amount,
        liquidation_ratio,
        balance_ratio,
        Number(collateralStatus)
      );
    }

    return new Loan(
      loanData.id,
      engine,
      Number(loanData.amount),
      oracle,
      descriptor,
      loanData.borrower,
      loanData.creator,
      status,
      Number(loanData.expiration),
      loanData.model,
      loanData.cosigner,
      debt,
      config,
      collateral
    );
  }

  /**
   * Assign collaterals to loans
   * @param loans Loans array
   * @param collaterals Collaterals array
   * @return Loans with collaterals
   */
  static completeLoansCollateral(loans: Loan[] = [], collaterals: Collateral[] = []): Loan[] {
    const loansObj: {[loanId: number]: Collateral[]} = {};

    collaterals.map(
      (collateral: Collateral) => {
        if (!loansObj[collateral.debtId]) {
          loansObj[collateral.debtId] = [];
        }
        loansObj[collateral.debtId].push(collateral);
      }
    );

    loans.map((loan: Loan) => {
      if (!loansObj[loan.id]) {
        return loan;
      }

      loansObj[loan.id].map((collateral: Collateral) => {
        const { id, debtId, oracle, token, amount, liquidationRatio, balanceRatio, status } = collateral;
        loan.collateral = new Collateral(id, debtId, oracle, token, amount, liquidationRatio, balanceRatio, status);
      });
    });

    return loans;
  }
}
