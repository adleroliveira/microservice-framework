import { LogStrategy } from "../utils/logging/LogStrategy";
import {
  IPublishingStrategy,
  ITextToAudioStrategy,
  ITable,
  IList,
  ISortedSet,
  ISet,
  IServiceRegistry,
} from "./";
import { PubSubConsumer } from "../PubSubConsumer";
import { BaseAudioGenerationConfig } from "./ITextToAudioStrategy";

export interface IBackEnd {
  // Shared Data Structures
  tables: Map<string, ITable>;
  lists: Map<string, IList>;
  sortedSets: Map<string, ISortedSet>;
  sets: Map<string, ISet>;

  // Service Discovery
  serviceRegistry: IServiceRegistry;

  publishing: Map<string, IPublishingStrategy>;
  audioGeneration: Map<string, ITextToAudioStrategy<BaseAudioGenerationConfig>>;
  pubSubConsumer: PubSubConsumer;

  // Factory Methods
  createSet: (name: string) => ISet<any>;
  getSet: (name: string) => ISet<any> | undefined;
  createTable: (name: string) => ITable<any>;
  getTable: (name: string) => ITable<any> | undefined;
  createList: (name: string) => IList<any>;
  getList: (name: string) => IList<any> | undefined;
  createSortedSet: (name: string) => ISortedSet<any>;
  getSortedSet: (name: string) => ISortedSet<any> | undefined;

  getPublishing(key: string): IPublishingStrategy | undefined;
  getAudioGeneration(
    key: string
  ): ITextToAudioStrategy<BaseAudioGenerationConfig> | undefined;
  getLogStrategy(key: string): LogStrategy;
  addPublishing(key: string, strategy: IPublishingStrategy): void;
  addAudioGeneration(
    key: string,
    strategy: ITextToAudioStrategy<BaseAudioGenerationConfig>
  ): void;
}
