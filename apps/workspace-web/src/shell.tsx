import { Alert } from './components/ui/alert.js';
import { Card } from './components/ui/card.js';
import { Button } from './components/ui/button.js';
// Shell primitives shared by the development fixture shell and the trusted
// Human workspace shell: the error boundary and the closed "not found" page.

import { Component } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

export class ContentBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <Card asChild>
        <Alert asChild variant="warning">
          <section role="alert" className="panel error">
            <h1>页面暂不可用</h1>
            <p>无法安全读取页面状态，请重新加载。</p>
            <Button
              onClick={() => {
                window.location.reload();
              }}
            >
              重新加载
            </Button>
          </section>
        </Alert>
      </Card>
    ) : (
      this.props.children
    );
  }
}

export function Missing() {
  return (
    <Card asChild>
      <section className="panel">
        <h1 tabIndex={-1}>无法打开此页面</h1>
        <p>未找到或无权访问这个精确对象。</p>
        <Link to="/workbench">返回工作台</Link>
      </section>
    </Card>
  );
}
