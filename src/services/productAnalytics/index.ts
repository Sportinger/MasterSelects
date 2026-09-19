import { ProductAnalyticsService } from './ProductAnalyticsService';

type ProductAnalyticsHotData = {
  productAnalyticsService?: ProductAnalyticsService;
};

const hotData = import.meta.hot?.data as ProductAnalyticsHotData | undefined;

export const productAnalytics = hotData?.productAnalyticsService ?? new ProductAnalyticsService();

if (import.meta.hot) {
  import.meta.hot.dispose((data: ProductAnalyticsHotData) => {
    data.productAnalyticsService = productAnalytics;
  });
}

export * from './catalog';
export * from './domainEvents';
export * from './failureClassification';
export * from './privacy';
export * from './timelineEditClassification';
