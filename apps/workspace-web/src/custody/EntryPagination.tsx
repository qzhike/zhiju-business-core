import { Button } from '../components/ui/button.js';
import { NativeSelect } from '../components/ui/native-select.js';
import { Label } from '../components/ui/label.js';

interface Props {
  readonly page: number;
  readonly pageCount: number;
  readonly pageSize: number;
  readonly loading: boolean;
  readonly onPage: (page: number) => void;
  readonly onPageSize: (size: number) => void;
}

export function EntryPagination({ page, pageCount, pageSize, loading, onPage, onPageSize }: Props) {
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1).filter(
    (number) =>
      pageCount <= 7 || number === 1 || number === pageCount || Math.abs(number - page) <= 1,
  );
  return (
    <div className="custody-pagination">
      <div className="custody-page-size">
        <Label htmlFor="custody-page-size">每页条数</Label>
        <NativeSelect
          id="custody-page-size"
          value={pageSize}
          disabled={loading}
          onChange={(event) => {
            onPageSize(Number(event.target.value));
          }}
        >
          {[20, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size} 条
            </option>
          ))}
        </NativeSelect>
      </div>
      <nav aria-label="条目清单分页">
        <Button
          size="sm"
          disabled={loading || page <= 1}
          onClick={() => {
            onPage(page - 1);
          }}
        >
          上一页
        </Button>
        {pages.map((number, index) => (
          <span className="custody-page-number" key={number}>
            {index > 0 && number > (pages[index - 1] ?? 0) + 1 && <span aria-hidden="true">…</span>}
            <Button
              size="sm"
              variant={number === page ? 'default' : 'outline'}
              aria-label={`第 ${number} 页`}
              aria-current={number === page ? 'page' : undefined}
              disabled={loading}
              onClick={() => {
                onPage(number);
              }}
            >
              {number}
            </Button>
          </span>
        ))}
        <Button
          size="sm"
          disabled={loading || page >= pageCount}
          onClick={() => {
            onPage(page + 1);
          }}
        >
          下一页
        </Button>
      </nav>
      <span className="muted">
        第 {page} / {pageCount} 页
      </span>
    </div>
  );
}
