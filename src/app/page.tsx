import { AuthGate } from '../components/AuthGate';
import { OwnerPortal } from '../components/OwnerPortal';
export default function Home() { return <AuthGate><OwnerPortal/></AuthGate>; }
