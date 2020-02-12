import * as crypto from 'crypto';
import BigNumber from 'bignumber.js';

import { TransactionReceipt } from './iface';
import {
  SigningError,
  BuildTransactionError,
  InvalidTransactionError,
  ExtendTransactionError, ParseTransactionError,
} from '../baseCoin/errors';
import { Address } from './address';
import { BaseKey } from '../baseCoin/iface';
import { signTransaction, isBase58Address, decodeTransaction } from './utils';
import { BaseCoin as CoinConfig } from '@bitgo/statics';
import { BaseTransactionBuilder } from '../baseCoin';
import { Transaction } from './transaction';
import { KeyPair } from "./keyPair";
import * as _ from 'lodash';

/**
 * Tron transaction builder.
 */
export class TransactionBuilder extends BaseTransactionBuilder {
  // transaction being built
  private _transaction: Transaction;
  /**
   * Public constructor.
   */
  constructor(_coinConfig: Readonly<CoinConfig>) {
    super(_coinConfig);
  }

  /**
   * Parse transaction takes in raw JSON directly from the node.
   *
   * @param rawTransaction The Tron transaction in JSON format as returned by the Tron lib or a
   *     stringifyed version of such JSON.
   */
  protected fromImplementation(rawTransaction: TransactionReceipt | string): Transaction {
    // TODO: add checks to ensure the raw_data, raw_data_hex, and txID are from the same transaction
    if (typeof rawTransaction === 'string') {
      const transaction = JSON.parse(rawTransaction);
      return new Transaction(this._coinConfig, transaction);
    }
    return new Transaction(this._coinConfig, rawTransaction);
  }

  /** @inheritdoc */
  protected signImplementation(key: BaseKey): Transaction {
    if (!this.transaction.inputs) {
      throw new SigningError('transaction has no sender');
    }

    if (!this.transaction.outputs) {
      throw new SigningError('transaction has no receiver');
    }

    const oldTransaction = this.transaction.toJson();
    // Store the original signatures to compare them with the new ones in a later step. Signatures
    // can be undefined if this is the first time the transaction is being signed
    const oldSignatureCount = oldTransaction.signature ? oldTransaction.signature.length : 0;
    let signedTransaction: TransactionReceipt;
    try {
      const keyPair = new KeyPair({ prv: key.key });
      // Since the key pair was generated using a private key, it will always have a prv attribute,
      // hence it is safe to use non-null operator
      signedTransaction = signTransaction(keyPair.getKeys().prv!, this.transaction.toJson());
    } catch (e) {
      throw new SigningError('Failed to sign transaction via helper.');
    }

    // Ensure that we have more signatures than what we started with
    if (!signedTransaction.signature || oldSignatureCount >= signedTransaction.signature.length) {
      throw new SigningError('Transaction signing did not return an additional signature.');
    }

    return new Transaction(this._coinConfig, signedTransaction);
  }

  /** @inheritdoc */
  protected buildImplementation(): Promise<Transaction> {
    // This is a no-op since Tron transactions are built from
    if (!this.transaction.id) {
      throw new BuildTransactionError('A valid transaction must have an id');
    }
    return Promise.resolve(this.transaction);
  }

  /**
   * Extend the validity of this transaction by the given amount of time
   * @param extensionMs The number of milliseconds to extend the validTo time
   */
  extendValidTo(extensionMs: number) {
    this.transaction.extendExpiration(extensionMs);
  }

  /** @inheritdoc */
  validateValue(value: BigNumber) {
    if (value.isLessThanOrEqualTo(0)) {
      throw new Error('Value cannot be below zero.');
    }

    // max long in Java - assumed upper limit for a TRX transaction
    if (value.isGreaterThan(new BigNumber('9223372036854775807'))) {
      throw new Error('Value cannot be greater than handled by the javatron node.');
    }
  }

  /** @inheritdoc */
  validateAddress(address: Address) {
    // assumes a base 58 address for our addresses
    if (!isBase58Address(address.address)) {
      throw new Error(address + ' is not a valid base58 address.');
    }
  }

  /** @inheritdoc */
  validateKey(key: BaseKey) {
    // TODO: determine valid key format
    return true;
  }

  /** @inheritdoc */
  /**
   * Validate the contents of a raw transaction. The validation
   * phase is to compare the raw-data-hex to the raw-data of the
   * transaction.
   *
   * The contents to be validated are
   * 1. The transaction id
   * 2. The expiration date
   * 3. The timestamp
   * 4. The contract
   * @param rawTransaction The raw transaction to be validated
   */
  validateRawTransaction(rawTransaction: TransactionReceipt | string): void {
    //TODO: Validation of signature
    if (!rawTransaction) {
      throw new InvalidTransactionError('Raw transaction is empty');
    }
    let currTransaction: TransactionReceipt;
    // rawTransaction can be either Stringified JSON OR
    // it can be a regular JSON object (not stringified).
    if (typeof rawTransaction === 'string') {
      try {
        currTransaction = JSON.parse(rawTransaction);
      } catch (e) {
        throw new ParseTransactionError('There was error in parsing the JSON string');
      }
    } else if (_.isObject(rawTransaction)) {
      currTransaction = rawTransaction;
    } else {
      throw new InvalidTransactionError('Transaction is not an object or stringified json');
    }
    const decodedRawDataHex = decodeTransaction(currTransaction.raw_data_hex);
    if (!currTransaction.txID) {
      throw new InvalidTransactionError('Transaction ID is empty');
    }
    //Validate the transaction ID from the raw data hex
    const hexBuffer = Buffer.from(currTransaction.raw_data_hex, 'hex');
    const currTxID = crypto
      .createHash('sha256')
      .update(hexBuffer)
      .digest('hex');
    if (currTransaction.txID != currTxID) {
      throw new InvalidTransactionError('Transaction has not have a valid id');
    }
    // Validate the expiration time from the raw-data-hex
    if (currTransaction.raw_data.expiration != decodedRawDataHex.expiration) {
      throw new InvalidTransactionError('Transaction has not have a valid expiration');
    }
    // Validate the timestamp from the raw-data-hex
    if (currTransaction.raw_data.timestamp != decodedRawDataHex.timestamp) {
      throw new InvalidTransactionError('Transaction has not have a valid timetamp');
    }
    // Transaction contract must exist
    if (!currTransaction.raw_data.contract) {
      throw new InvalidTransactionError('Transaction contracts are empty');
    }
  }

  /** @inheritDoc Specifically, checks hex underlying transaction hashes to correct transaction ID. */
  validateTransaction(transaction: Transaction) {
    const hexBuffer = Buffer.from(transaction.toJson().raw_data_hex, 'hex');
    const txId = crypto
      .createHash('sha256')
      .update(hexBuffer)
      .digest('hex');
    if (transaction.id != txId) {
      throw new InvalidTransactionError(transaction.id + ' is not a valid transaction id. Expecting: ' + txId);
    }
  }

  /** @inheritdoc */
  protected get transaction(): Transaction {
    return this._transaction;
  }

  /** @inheritdoc */
  protected set transaction(transaction: Transaction) {
    this._transaction = transaction;
  }
}