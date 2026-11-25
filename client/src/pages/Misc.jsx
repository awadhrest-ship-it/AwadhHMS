import { Link } from 'react-router-dom';
import { ShieldOff, Compass } from 'lucide-react';
import { EmptyState } from '../components/ui';

export const Forbidden = () => <EmptyState icon={ShieldOff} title="You don't have access to this page" text="Your role does not include this module. Ask the General Manager or Owner if you need it." action={<Link className="btn btn-secondary" to="/">Go to my home</Link>} />;
export const NotFound = () => <EmptyState icon={Compass} title="Page not found" text="The page you are looking for does not exist." action={<Link className="btn btn-secondary" to="/">Go to my home</Link>} />;
