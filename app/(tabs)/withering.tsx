import React from 'react';
import ProcessScreen from '../../src/components/ProcessScreen';

// Safe area and width are handled inside Screen, so this stays a thin wrapper.
export default function Withering() {
  return <ProcessScreen process="withering" />;
}
