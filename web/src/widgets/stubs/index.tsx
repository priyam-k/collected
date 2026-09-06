import { ComingSoon } from '@/widgets/Placeholder';
import type { WidgetProps } from '@/widgets/types';

export const makeStub = (what: string) =>
  function StubWidget(_props: WidgetProps) {
    return <ComingSoon what={what} />;
  };
