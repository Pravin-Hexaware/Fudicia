import React from 'react';

type HeaderProps = {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  className?: string;
  currentStep?: number;
  stepContent?: Array<{ title?: string; subtitle?: string; right?: React.ReactNode }>;
};

const Header: React.FC<HeaderProps> = ({ title, subtitle, right, className = '', currentStep, stepContent }) => {
  const stepTitle = stepContent && typeof currentStep === 'number' && stepContent[currentStep]?.title;
  const stepSubtitle = stepContent && typeof currentStep === 'number' && stepContent[currentStep]?.subtitle;
  const stepRight = stepContent && typeof currentStep === 'number' && stepContent[currentStep]?.right;
  return (
    <header className={`border-b sticky top-0 bg-background/95 bg-white z-50 ${className}`}>
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold">{stepTitle ?? title}</h1>
              {(stepSubtitle || subtitle) && (
                <p className="text-xs text-muted-foreground">{stepSubtitle ?? subtitle}</p>
              )}
            </div>
          </div>
          {(stepRight || right) && (
            <div className="ml-4 flex items-center">{stepRight ?? right}</div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
