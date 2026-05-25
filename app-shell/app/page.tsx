import { redirect } from 'next/navigation';

// The app root sends users straight to their dashboard. (basePath '/app' makes
// this resolve to /app/dashboard on orcatrade.pl.)
export default function Home() {
  redirect('/dashboard');
}
