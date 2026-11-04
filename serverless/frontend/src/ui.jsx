import React from 'react';
import { Button as GlisseButton, Glass, Input, Switch } from 'glisse';
import { telegram } from './telegram';
export function Button({ primary = false, danger = false, className = '', onClick, ...props }) {
  return <GlisseButton {...props} variant={primary ? 'filled' : 'glass'} destructive={danger} className={'app-button ' + className} onClick={event => { try { telegram()?.HapticFeedback?.selectionChanged(); } catch {} onClick?.(event); }} />;
}
export function Panel({ title, children, className = '', ...props }) {
  return <Glass className={'app-panel ' + className} {...props}>{title && <h2>{title}</h2>}{children}</Glass>;
}
export function Field({ label, ...props }) {
  return <label className="app-field"><span>{label}</span><Input className="app-input" {...props} /></label>;
}
export function Select({ label, children, ...props }) {
  return <label className="app-field"><span>{label}</span><select {...props}>{children}</select></label>;
}
export function Textarea({ label, ...props }) {
  return <label className="app-field"><span>{label}</span><textarea rows={4} {...props} /></label>;
}
export function Toggle({ label, ...props }) {
  const id = React.useId();
  return <div className="app-toggle"><span id={id}>{label}</span><Switch aria-labelledby={id} {...props} /></div>;
}
export function Status({ error, children }) {
  return <Panel className={error ? 'app-error' : ''} role={error ? 'alert' : 'status'}>{children}</Panel>;
}
export class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <main className="app-shell"><Status error>Ошибка интерфейса: {this.state.error.message}</Status><Button onClick={() => window.location.reload()}>Перезагрузить</Button><Button onClick={() => window.location.assign('../index.html')}>Старый интерфейс</Button></main>;
    return this.props.children;
  }
}
